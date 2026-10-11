"""Private booking documents rendered into immutable personal PDF assets."""
import json,re
from urllib.parse import urlencode
import google_connection as connection
import google_layout,sanity_sources,ticket_import

KINDS=('schedule','nsTickets','voucher','letter')

def store(s,raw,title):
    reader,meta=s.inspect_pdf(raw);s.ensure_capacity(len(raw));ident=s.ident()
    (s.DATA/'pdfs'/f'{ident}.pdf').write_bytes(raw)
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,title,len(reader.pages),json.dumps(meta),s.now()))
    return {'asset':ident,'pages':len(reader.pages),'meta':meta,'format':s.pdf_format(meta),'title':title}

def render(s,payload):
    doc=payload.get('document',{});fmt=payload.get('format','A4')
    if fmt not in s.SIZES or doc.get('kind') not in ('letter','voucher') or not isinstance(doc.get('content'),list):raise ValueError('Ongeldig Sanity-boekingsdocument.')
    if len(json.dumps(doc))>4*1024*1024:raise ValueError('Boekingsdocument te groot.')
    m,images=sanity_sources.model([doc],{'title':doc.get('title','Brief'),'columns':1})
    return {**store(s,google_layout.render(m,images,fmt,'route'),m['title']),'bookingDocument':{k:doc[k] for k in ('bookingId','documentId','kind','revision','digest','loadedAt') if k in doc}}

def drive_access(data):
    if not connection.status(data).get('canReadDrive'):raise ValueError('Koppel Google Drive met leestoegang voor bestaande bestanden, of upload zelf een PDF.')

def number(value):
    value=str(value).strip().upper()
    if not re.fullmatch(r'\d{3,8}[A-Z]?',value):raise ValueError('Vul een boekingsnummer in.')
    return re.sub(r'[A-Z]$','',value)

def drive_search(s,payload):
    drive_access(s.DATA);n=number(payload.get('number',''));kind=payload.get('kind')
    if kind not in ('schedule','voucher'):raise ValueError('Kies reisschema of voucher.')
    q=f"trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.document') and name contains '{n}'"
    args={'q':q,'fields':'files(id,name,mimeType,modifiedTime),nextPageToken','pageSize':100,'orderBy':'modifiedTime desc','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
    found=[];access=connection.token(s.DATA)
    for page in range(5):
        result=json.loads(connection.request('https://www.googleapis.com/drive/v3/files?'+urlencode(args),token=access))
        for f in result.get('files',[]):
            if not re.search(r'(?<!\d)'+re.escape(n)+r'[A-Za-z]?(?!\d)',f['name']):continue
            label=f['name'].lower();recommended=bool(re.search(r'reisschema|tijdlijn|reis.?schema|itinerary',label) if kind=='schedule' else re.search(r'voucher',label))
            found.append({'id':f['id'],'title':f['name'],'mimeType':f['mimeType'],'updatedAt':f.get('modifiedTime',''),'recommended':recommended})
        if not result.get('nextPageToken'):break
        args['pageToken']=result['nextPageToken']
    else:raise ValueError('Te veel Drive-bestanden gevonden. Upload het juiste document zelf.')
    return {'items':sorted(found,key=lambda f:not f['recommended'])}

def drive_load(s,payload):
    drive_access(s.DATA);n=number(payload.get('number',''));ident=payload.get('id','');fmt=payload.get('format','A4')
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,150}',ident) or fmt not in s.SIZES:raise ValueError('Ongeldig Drive-bestand.')
    access=connection.token(s.DATA);base='https://www.googleapis.com/drive/v3/files/'+ident
    info=json.loads(connection.request(base+'?fields=id,name,mimeType&supportsAllDrives=true',token=access))
    if not re.search(r'(?<!\d)'+re.escape(n)+r'[A-Za-z]?(?!\d)',info['name']):raise ValueError('Dit bestand heeft een ander boekingsnummer. Upload het na handmatige controle.')
    if info['mimeType']=='application/vnd.google-apps.document':raw=connection.request(base+'/export?mimeType=application%2Fpdf',token=access,limit=30*1024*1024)
    elif info['mimeType']=='application/pdf':raw=connection.request(base+'?alt=media&supportsAllDrives=true',token=access,limit=30*1024*1024)
    else:raise ValueError('Kies een PDF of Google-document.')
    result=store(s,raw,info['name'])
    return {**result,'driveDocument':{'id':ident,'title':info['name']}}
