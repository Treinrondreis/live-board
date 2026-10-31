"""Versioned private travel websites from immutable, checked booklet exports."""
import base64,hashlib,hmac,io,json,re,secrets,threading,time
from datetime import datetime,timezone
from pathlib import Path
from pypdf import PdfReader,PdfWriter
import google_connection

PREFIX='/seinhuis/boekjesmaker/reis/'
ATTEMPTS={};LOCK=threading.RLock();RENDER=threading.BoundedSemaphore(2)

def initialize(c):
    c.execute('CREATE TABLE IF NOT EXISTS travel_sites(id TEXT PRIMARY KEY, export_id TEXT UNIQUE, salt TEXT, digest TEXT, code BLOB, created TEXT, expires INTEGER, revoked INTEGER, content TEXT)')

def category(section):
    docs=section.get('bookingDocuments',[])
    document=section.get('_websiteKind','')
    if document.endswith('Tickets') or section.get('ticketImport') or any(d.get('kind')=='ticket' for d in docs):return 'tickets'
    if document=='voucher' or section.get('mailVoucherImport') or any(d.get('kind')=='voucher' for d in docs):return 'hotels'
    if section.get('routeMaker') or section.get('googleDoc',{}).get('layout')=='route':return 'routes'
    return 'informatie'

def chapter_metadata(section):
    dates=sorted({p.get('travelDate','') for p in section.get('pageSources',[]) if re.fullmatch(r'20\d{2}-\d{2}-\d{2}',p.get('travelDate',''))})
    dates+=sorted({d.get('travelDate','') for d in section.get('bookingDocuments',[]) if re.fullmatch(r'20\d{2}-\d{2}-\d{2}',d.get('travelDate','')) and d.get('travelDate') not in dates})
    return {'kind':category(section),'dates':dates}

def digest(code,salt):return hashlib.pbkdf2_hmac('sha256',code.encode(),bytes.fromhex(salt),180000).hex()

def credentials():
    code=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(10))
    salt=secrets.token_hex(16)
    return salt,digest(code,salt),google_connection.protect(code.encode())

def export_row(s,ident):
    if not isinstance(ident,str) or not re.fullmatch(r'[a-f0-9]{32}',ident):raise ValueError('Ongeldige PDF-versie.')
    with s.db() as c:
        row=c.execute('SELECT * FROM exports WHERE id=?',(ident,)).fetchone()
        deleted=s.export_history.deleted(c,ident)
        book=c.execute('SELECT body FROM objects WHERE id=?',(row['book_id'],)).fetchone() if row else None
    if not row or deleted or book and json.loads(book['body']).get('deletedAt'):raise ValueError('Deze PDF-versie is niet beschikbaar.')
    return row

def content(s,row):
    report=json.loads(row['report']);chapters=report.get('digitalChapters') or [{'title':'Uw reisboekje','pageNumbers':list(range(1,report['pages']+1))}]
    sections=json.loads(row['snapshot']).get('body',{}).get('sections',[])
    result=[];total=0;deadline=time.monotonic()+20
    with s.export_storage.pdf(s,row['id']) as path:
        reader=PdfReader(path)
        if not 1<=len(reader.pages)<=500:raise ValueError('Het boekje is te groot voor de reiswebsite.')
        for chapter in chapters:
            if time.monotonic()>deadline:raise ValueError('De reiswebsite maken duurt te lang.')
            numbers=chapter.get('pageNumbers') or list(range(chapter['page'],chapter['end']+1))
            if not numbers or any(type(n) is not int or not 1<=n<=len(reader.pages) for n in numbers):raise ValueError('Ongeldige hoofdstukpagina’s.')
            legacy={}
            if report.get('digitalChapters') and 'kind' not in chapter:
                matches=[i for i,start in enumerate(report.get('chapterStarts',[])) if start['page']==numbers[0] and i<len(sections)]
                if len(matches)==1:legacy=chapter_metadata(sections[matches[0]])
            kind=chapter.get('kind',legacy.get('kind','informatie'));texts=[]
            if kind!='tickets':
                for n in numbers:
                    text=reader.pages[n-1].extract_text() or ''
                    if len(text)>60000:raise ValueError('Een pagina bevat te veel tekst voor de reiswebsite.')
                    texts.append(text.strip());total+=len(text)
            if total>2000000:raise ValueError('Het boekje bevat te veel tekst voor de reiswebsite.')
            result.append({'title':str(chapter.get('title','Reisinformatie'))[:200],'kind':kind,'dates':chapter.get('dates',legacy.get('dates',[])),'pageNumbers':numbers,'text':'\n\n'.join(texts)})
    return {'title':row['title'],'created':row['created'],'chapters':result}

def ensure(s,ident):
    row=export_row(s,ident)
    with s.db() as c:existing=c.execute('SELECT id FROM travel_sites WHERE export_id=?',(ident,)).fetchone()
    if not existing:
        data=content(s,row);salt,hashed,encrypted=credentials()
        expires=int(time.time())+365*86400
        booking=json.loads(row['snapshot']).get('body',{}).get('sanityBooking',{})
        days=[d for chapter in data['chapters'] for d in chapter['dates']]+[booking.get('returnDate','')]
        for day in days:
            try:expires=max(expires,min(int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())+30*86400,int(time.time())+3*365*86400))
            except (ValueError,TypeError):pass
        with s.db() as c:c.execute('INSERT OR IGNORE INTO travel_sites VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),ident,salt,hashed,encrypted,s.now(),expires,0,json.dumps(data,ensure_ascii=False)))
    return info(s,ident)

def info(s,ident):
    export_row(s,ident)
    with s.db() as c:row=c.execute('SELECT * FROM travel_sites WHERE export_id=?',(ident,)).fetchone()
    if not row:return {'exists':False}
    return {'exists':True,'url':PREFIX+row['id'],'code':google_connection.protect(row['code'],True).decode(),'expires':datetime.fromtimestamp(row['expires'],timezone.utc).date().isoformat(),'revoked':bool(row['revoked'])}

def manage(s,body):
    ident=body.get('id');action=body.get('action','info');export_row(s,ident)
    if action=='ensure':return ensure(s,ident)
    if action=='info':return info(s,ident)
    if action not in ('disable','reset','enable'):raise ValueError('Onbekende websiteactie.')
    with s.db() as c:
        row=c.execute('SELECT * FROM travel_sites WHERE export_id=?',(ident,)).fetchone()
        if not row:raise ValueError('Maak eerst de reiswebsite.')
        if action=='disable':c.execute('UPDATE travel_sites SET revoked=1 WHERE export_id=?',(ident,))
        else:
            salt,hashed,encrypted=credentials()
            c.execute('UPDATE travel_sites SET salt=?,digest=?,code=?,revoked=0,expires=? WHERE export_id=?',(salt,hashed,encrypted,max(row['expires'],int(time.time())+365*86400),ident))
    with LOCK:ATTEMPTS.pop(row['id'],None)
    return info(s,ident)

def lookup(s,ident):
    with s.db() as c:row=c.execute('SELECT * FROM travel_sites WHERE id=?',(ident,)).fetchone()
    if not row or row['revoked'] or row['expires']<=time.time():return None
    try:export_row(s,row['export_id'])
    except ValueError:return None
    return row

def token(row,expires):
    message=row['id']+'|'+str(expires)
    return str(expires)+'.'+hmac.new(bytes.fromhex(row['digest']),message.encode(),'sha256').hexdigest()

def authorized(row,value):
    if not re.fullmatch(r'\d{10}\.[a-f0-9]{64}',value or ''):return False
    expires=int(value.split('.')[0])
    return time.time()<expires<=min(row['expires'],time.time()+7*86400+60) and hmac.compare_digest(value,token(row,expires))

def response_json(response,status,data,headers=None):return response(status,data,headers=headers)

def handle(s,path,environ,response):
    match=re.fullmatch(r'/internal/travel-sites/([a-f0-9]{32})(?:/(data|login|logout|book|cover|chapter/\d{1,3}))?',path)
    if not match:return response(404,{'error':'Niet gevonden.'})
    ident,action=match.groups();action=action or 'page';method=environ['REQUEST_METHOD']
    if method!=('POST' if action in ('login','logout') else 'GET'):return response(405,{'error':'Ongeldige methode.'})
    row=lookup(s,ident)
    if not row:return response(404,{'error':'Deze reiswebsite is niet beschikbaar.'})
    if action=='page':
        raw=(s.ROOT/'travel-site.html').read_bytes()
        script=raw.split(b'<script>',1)[1].split(b'</script>',1)[0].replace(b'\r\n',b'\n').replace(b'\r',b'\n')
        policy="default-src 'none'; script-src 'sha256-"+base64.b64encode(hashlib.sha256(script).digest()).decode()+"'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        return response(200,raw,'text/html; charset=utf-8',{'Content-Security-Policy':policy})
    cookie_name='trr_reis_'+ident;cookie_path=PREFIX+ident
    def cookie(value,age):return {'Set-Cookie':f'{cookie_name}={value}; Max-Age={age}; Path={cookie_path}; HttpOnly; Secure; SameSite=Strict'}
    if action=='logout':return response_json(response,200,{'ok':True},cookie('',0))
    if action=='login':
        with LOCK:
            now=time.time()
            for key in list(ATTEMPTS):
                if ATTEMPTS[key][1]<now:del ATTEMPTS[key]
            if len(ATTEMPTS)>2000:return response(429,{'error':'Probeer het later opnieuw.'})
            attempts,until=ATTEMPTS.get(ident,(0,now+900))
            if attempts>=10:return response(429,{'error':'Te veel pogingen. Probeer over een kwartier opnieuw.'},headers={'Retry-After':'900'})
            ATTEMPTS[ident]=(attempts+1,until)
        try:
            size=int(environ.get('CONTENT_LENGTH') or 0)
            if not 1<=size<=512:raise ValueError()
            body=json.loads(environ['wsgi.input'].read(size));code=body.get('code','').replace(' ','').upper()
            if not re.fullmatch(r'[A-Z2-9]{10}',code) or not hmac.compare_digest(digest(code,row['salt']),row['digest']):raise ValueError()
        except (ValueError,TypeError,AttributeError):return response(401,{'error':'De toegangscode klopt niet.'})
        with LOCK:ATTEMPTS.pop(ident,None)
        return response_json(response,200,{'ok':True},cookie(token(row,min(row['expires'],int(time.time())+7*86400)),7*86400))
    if environ.get('HTTP_X_TRAVEL_SITE_OWNER')!='1' and not authorized(row,environ.get('HTTP_X_TRAVEL_SITE_SESSION','')):return response(401,{'error':'Voer uw toegangscode in.'})
    data=json.loads(row['content'])
    if action=='data':return response(200,{**data,'chapters':[{k:v for k,v in c.items() if k!='pageNumbers'} for c in data['chapters']]})
    if not RENDER.acquire(blocking=False):return response(429,{'error':'Het document wordt voorbereid. Probeer het opnieuw.'},headers={'Retry-After':'3'})
    try:
        with s.export_storage.pdf(s,row['export_id']) as source:
            if action=='book':return response(200,Path(source).read_bytes(),'application/pdf',{'Content-Disposition':s.export_names.disposition(s,row['export_id'],'attachment')})
            if action=='cover':
                import pymupdf
                with pymupdf.open(source) as doc:return response(200,doc[0].get_pixmap(matrix=pymupdf.Matrix(.7,.7)).tobytes('png'),'image/png')
            index=int(action.split('/')[1])
            if not 0<=index<len(data['chapters']):return response(404,{'error':'Document niet gevonden.'})
            reader=PdfReader(source);writer=PdfWriter()
            for n in data['chapters'][index]['pageNumbers']:writer.add_page(reader.pages[n-1])
            output=io.BytesIO();writer.write(output)
            return response(200,output.getvalue(),'application/pdf',{'Content-Disposition':'inline; filename="reisdocument.pdf"'})
    finally:RENDER.release()
