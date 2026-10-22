"""Private print quotes and durable duplicate protection; no printer credentials here."""
import hashlib,json,re,time
from contextlib import contextmanager
from wsgiref.util import FileWrapper
import export_storage,export_history

MAX_PDF=512*1024*1024

def initialize(c):
    c.executescript('''
        CREATE TABLE IF NOT EXISTS print_quotes(id TEXT PRIMARY KEY,export_id TEXT NOT NULL,created REAL NOT NULL,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS print_orders(export_id TEXT PRIMARY KEY,quote_id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL);
    ''')

def ident(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{32}',value):raise ValueError('Ongeldige drukversie of prijsopgave.')
    return value

def source(s,value):
    value=ident(value)
    with s.db() as c:
        row=c.execute('SELECT * FROM exports WHERE id=?',(value,)).fetchone()
        if not row or export_history.deleted(c,value):raise ValueError('Deze PDF is niet beschikbaar voor bestellen.')
        latest=c.execute('SELECT e.id FROM exports e LEFT JOIN export_details d ON d.id=e.id WHERE e.book_id=? AND d.deleted_at IS NULL ORDER BY e.rowid DESC LIMIT 1',(row['book_id'],)).fetchone()
        book=c.execute('SELECT body FROM objects WHERE id=? AND kind=?',(row['book_id'],'book')).fetchone()
        if not latest or latest['id']!=value or not book or json.loads(book['body']).get('deletedAt'):raise ValueError('Gebruik de nieuwste PDF van een actief boekje.')
        snapshot=json.loads(row['snapshot']);body=snapshot.get('body',{});binding=body.get('sanityBooking',{}).get('id')
        if not binding or json.loads(book['body']).get('sanityBooking',{}).get('id')!=binding:raise ValueError('Koppel de juiste Sanity-boeking en maak eerst een nieuwe PDF.')
        if body.get('outputMode')=='screen' or body.get('format','A4')!='A4':raise ValueError('Maak eerst een A4-drukwerk-PDF voor het magazine.')
        return {'id':value,'bookId':row['book_id'],'title':row['title'],'created':row['created'],'bookingId':binding}

@contextmanager
def verified_pdf(s,value,expected=None):
    meta=source(s,value)
    with export_storage.pdf(s,value) as path:
        size=path.stat().st_size
        if not 0<size<=MAX_PDF:raise ValueError('De druk-PDF is te groot of leeg.')
        reader=s.PdfReader(path);pages=len(reader.pages)
        if pages<8 or pages%4:raise ValueError('Een gevouwen en geniet magazine moet minimaal acht pagina’s en een veelvoud van vier pagina’s bevatten. Maak een nieuwe druk-PDF met passende vulling.')
        if any(abs(float(p.mediabox.width)-595.276)>3 or abs(float(p.mediabox.height)-841.89)>3 or int(p.get('/Rotate',0))%360 for p in reader.pages):raise ValueError('Alle PDF-pagina’s moeten A4 staand zijn voor dit magazine.')
        with path.open('rb') as stream:sha=hashlib.file_digest(stream,'sha256').hexdigest()
        if expected and sha!=expected:raise ValueError('De PDF wijkt af van de bevestigde drukversie.')
        yield path,{**meta,'pages':pages,'size':size,'sha256':sha}

def metadata(s,value):
    with verified_pdf(s,value) as (_,meta):return meta

@contextmanager
def download_pdf(s,value,expected):
    if not isinstance(expected,str) or not re.fullmatch('[a-f0-9]{64}',expected):raise ValueError('PDF-controle ontbreekt.')
    with verified_pdf(s,value,expected) as (path,_):yield path

def quote(s,value):
    with s.db() as c:row=c.execute('SELECT payload FROM print_quotes WHERE id=?',(ident(value),)).fetchone()
    if not row:raise ValueError('Prijsopgave niet gevonden. Bereken de prijs opnieuw.')
    return json.loads(row['payload'])

def record(s,value):
    with s.db() as c:row=c.execute('SELECT * FROM print_orders WHERE export_id=?',(ident(value),)).fetchone()
    return {**dict(row),'payload':json.loads(row['payload'])} if row else None

def action(s,operation,b):
    value=ident(b.get('exportId'))
    if operation=='record':return record(s,value)
    source(s,value)
    if operation=='quote':
        q=b.get('quote');ident(q.get('id') if isinstance(q,dict) else None)
        if q.get('exportId')!=value or not isinstance(q.get('expires'),(int,float)):raise ValueError('Ongeldige prijsopgave.')
        with s.db() as c:
            c.execute("DELETE FROM print_quotes WHERE created<? AND id NOT IN (SELECT quote_id FROM print_orders WHERE state IN ('uploading','submitting','uncertain'))",(time.time()-7*86400,))
            c.execute('INSERT INTO print_quotes VALUES(?,?,?,?)',(q['id'],value,time.time(),json.dumps(q)))
        return {'ok':True}
    if operation=='get-quote':
        q=quote(s,b.get('quoteId'))
        if q['exportId']!=value:raise ValueError('Prijsopgave hoort bij een andere PDF.')
        return q
    if operation=='claim':
        q=quote(s,b.get('quoteId'))
        if q['exportId']!=value or q['expires']<time.time()*1000:raise ValueError('Prijsopgave verlopen. Bereken opnieuw.')
        with s.LOCK,s.db() as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT * FROM print_orders WHERE export_id=?',(value,)).fetchone()
            if row and row['state'] not in ('upload_failed','rejected'):return {'claimed':False,**dict(row),'payload':json.loads(row['payload'])}
            payload={'reference':q['reference'],'totalCents':q['price']['totalCents'],'environment':q['environment']}
            c.execute('INSERT OR REPLACE INTO print_orders VALUES(?,?,?,?)',(value,q['id'],'uploading',json.dumps(payload)))
        return {'claimed':True}
    if operation=='update':
        allowed={'uploading':{'submitting','upload_failed'},'submitting':{'placed','uncertain','rejected'},'uncertain':{'placed'},'placed':{'placed'}}
        with s.LOCK,s.db() as c:
            c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM print_orders WHERE export_id=?',(value,)).fetchone()
            if not row or row['quote_id']!=b.get('quoteId') or b.get('state') not in allowed.get(row['state'],set()):raise ValueError('De bestelstatus is gewijzigd. Open de bestelling opnieuw.')
            payload={**json.loads(row['payload']),**b.get('receipt',{})}
            c.execute('UPDATE print_orders SET state=?,payload=? WHERE export_id=?',(b['state'],json.dumps(payload),value))
        return {'ok':True}
    raise ValueError('Onbekende bestelactie.')

def handle(s,path,env,response,stream_type,start_response):
    try:
        operation=path.removeprefix('/internal/print-orders/')
        if env['REQUEST_METHOD']!='POST':return response(405,{'error':'Gebruik POST.'})
        size=int(env.get('CONTENT_LENGTH') or 0)
        if not 0<size<=32768:raise ValueError('Ongeldige bestelopdracht.')
        b=json.loads(env['wsgi.input'].read(size))
        if operation=='metadata':return response(200,metadata(s,ident(b.get('exportId'))))
        if operation=='pdf':
            stream=stream_type(download_pdf(s,ident(b.get('exportId')),b.get('sha256')))
            try:
                start_response('200 OK',[('Content-Type','application/pdf'),('Content-Length',str(stream.path.stat().st_size)),('Cache-Control','no-store')])
                return FileWrapper(stream,65536)
            except Exception:stream.close();raise
        return response(200,action(s,operation,b))
    except ValueError as error:return response(400,{'error':str(error)})
    except (TypeError,KeyError):return response(400,{'error':'Ongeldige bestelopdracht.'})
