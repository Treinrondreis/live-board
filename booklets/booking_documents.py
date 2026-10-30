"""Private booking documents rendered into immutable personal PDF assets."""
import base64,json,os,re
from urllib.parse import urlencode
import google_connection as connection
import google_layout,sanity_sources,ticket_import,booking_letter_layout

TICKET_KINDS=('nsTickets','mavTickets','dbTickets','obbTickets','cdTickets','dfdsTickets','combinedTickets')
KINDS=('schedule',*TICKET_KINDS,'voucher','letter')

def store(s,raw,title):
    reader,meta=s.inspect_pdf(raw);s.ensure_capacity(len(raw));ident=s.ident()
    (s.DATA/'pdfs'/f'{ident}.pdf').write_bytes(raw)
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,title,len(reader.pages),json.dumps(meta),s.now()))
    return {'asset':ident,'pages':len(reader.pages),'meta':meta,'format':s.pdf_format(meta),'title':title}

def render(s,payload):
    doc=payload.get('document',{});fmt=payload.get('format','A4')
    requested_layout=payload.get('letterLayout','text')
    if requested_layout not in ('text','columns'):raise ValueError('Kies één of twee kolommen voor de brief.')
    if fmt not in s.SIZES or doc.get('kind') not in ('letter','voucher') or not isinstance(doc.get('content'),list):raise ValueError('Ongeldig Sanity-boekingsdocument.')
    if len(json.dumps({k:v for k,v in doc.items() if k!='originalPdf'}))>4*1024*1024:raise ValueError('Boekingsdocument te groot.')
    if doc.get('originalPdf'):
        encoded=doc['originalPdf']
        if not isinstance(encoded,str) or len(encoded)>40*1024*1024:raise ValueError('Originele Sanity-PDF te groot.')
        try:raw=base64.b64decode(encoded,validate=True)
        except (ValueError,TypeError):raise ValueError('Ongeldige originele Sanity-PDF.')
        warnings=doc.get('warnings',[])
        if not isinstance(warnings,list) or len(warnings)>100 or any(not isinstance(w,str) or len(w)>2000 for w in warnings):raise ValueError('Ongeldige documentwaarschuwingen.')
        return {**store(s,raw,doc.get('title','Sanity-document')),'warnings':warnings,'bookingDocument':{**{k:doc[k] for k in ('bookingId','documentId','kind','revision','digest','loadedAt','travelDate','attachment') if k in doc},'originalPdf':True}}
    m,images=sanity_sources.model([doc],{'title':doc.get('title','Brief'),'columns':1})
    warnings=doc.get('warnings',[])
    if not isinstance(warnings,list) or len(warnings)>100 or any(not isinstance(w,str) or len(w)>2000 for w in warnings):raise ValueError('Ongeldige documentwaarschuwingen.')
    if doc['kind']=='letter':
        raw=booking_letter_layout.render(m,images,fmt,layout=requested_layout)
        layout=booking_letter_layout.COLUMNS_VERSION if requested_layout=='columns' else booking_letter_layout.VERSION
        notice='Deze brief is vanuit Sanity-tekst opgemaakt in Treinrondreis-huisstijl. De paginaverdeling kan afwijken van de originele Sanity-PDF.'
    else:
        raw=booking_letter_layout.render(m,images,fmt,'voucher')
        layout=booking_letter_layout.VOUCHER_VERSION
        notice='Deze voucher is opnieuw opgemaakt vanuit Sanity-tekst in Treinrondreis-huisstijl. De paginaverdeling kan afwijken van de originele Sanity-PDF.'
    return {**store(s,raw,m['title']),'warnings':[*warnings,notice],'bookingDocument':{**{k:doc[k] for k in ('bookingId','documentId','kind','revision','digest','loadedAt','travelDate') if k in doc},'layout':layout}}

def check_slot_layout(slot):
    if slot.get('documentKind')!='letter' or not slot.get('selected'):return
    section=slot['selected'];sources=section.get('bookingDocuments') or ([section['bookingDocument']] if section.get('bookingDocument') else [])
    expected=booking_letter_layout.COLUMNS_VERSION if slot.get('letterLayout')=='columns' else booking_letter_layout.VERSION
    for source in sources:
        actual=source.get('layout') or booking_letter_layout.VERSION
        matches=source.get('originalPdf') if slot.get('preferOriginalPdf') else not source.get('originalPdf') and actual==expected
        if not matches:raise ValueError('De briefopmaak is gewijzigd. Haal de brief opnieuw op en controleer de nieuwe pagina’s. De bestaande PDF blijft bewaard.')

def drive_access(data):
    if not connection.status(data).get('canReadDrive'):raise ValueError('Koppel Google Drive met leestoegang voor bestaande bestanden, of upload zelf een PDF.')

def number(value):
    value=str(value).strip().upper()
    if not re.fullmatch(r'\d{3,8}[A-Z]?',value):raise ValueError('Vul een boekingsnummer in.')
    return re.sub(r'[A-Z]$','',value)

def drive_search(s,payload):
    drive_access(s.DATA);n=number(payload.get('number',''));kind=payload.get('kind')
    if kind not in ('schedule','voucher'):raise ValueError('Kies reisschema of voucher.')
    folders=voucher_folders() if kind=='voucher' else []
    found={};access=connection.token(s.DATA)
    for folder in folders:
        info=json.loads(connection.request('https://www.googleapis.com/drive/v3/files/'+folder+'?fields=id,mimeType,trashed&supportsAllDrives=true',token=access))
        if info.get('trashed') or info.get('mimeType')!='application/vnd.google-apps.folder':raise ValueError('De ingestelde hotelvouchermap is geen beschikbare Google Drive-map.')
    for source_folder in ['',*folders]:
        q=f"trashed = false and (mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.document') and name contains '{n}'"
        if source_folder:q+=f" and '{source_folder}' in parents"
        args={'q':q,'fields':'files(id,name,mimeType,modifiedTime),nextPageToken','pageSize':100,'orderBy':'modifiedTime desc','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
        for page in range(5):
            result=json.loads(connection.request('https://www.googleapis.com/drive/v3/files?'+urlencode(args),token=access))
            for f in result.get('files',[]):
                if not re.search(r'(?<!\d)'+re.escape(n)+r'[A-Za-z]?(?!\d)',f['name']):continue
                label=f['name'].lower()
                if kind=='voucher' and re.search(r'reisschema|tijdlijn|itinerary|factuur|invoice|ticket',label):continue
                recommended=bool(re.search(r'reisschema|tijdlijn|reis.?schema|itinerary',label) if kind=='schedule' else source_folder or re.search(r'voucher',label))
                if kind=='voucher' and not recommended:continue
                found[f['id']]={'id':f['id'],'title':f['name'],'mimeType':f['mimeType'],'updatedAt':f.get('modifiedTime',''),'recommended':recommended,**({'voucherFolder':source_folder} if source_folder else {})}
            if not result.get('nextPageToken'):break
            args['pageToken']=result['nextPageToken']
        else:raise ValueError('Te veel Drive-bestanden gevonden. Upload het juiste document zelf.')
    return {'items':sorted(found.values(),key=lambda f:not f['recommended'])}

def voucher_folders():
    folders=[]
    for key in ('BOOKLETS_VOUCHER_DRIVE_FOLDER_ID','BOOKLETS_VOUCHER_ARCHIVE_DRIVE_FOLDER_ID'):
        folder=os.environ.get(key,'').strip()
        if folder and not re.fullmatch(r'[A-Za-z0-9_-]{10,150}',folder):raise ValueError('De hotelvouchermap is niet geldig ingesteld.')
        if folder and folder not in folders:folders.append(folder)
    return folders

def drive_load(s,payload):
    drive_access(s.DATA);n=number(payload.get('number',''));ident=payload.get('id','');fmt=payload.get('format','A4')
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,150}',ident) or fmt not in s.SIZES:raise ValueError('Ongeldig Drive-bestand.')
    access=connection.token(s.DATA);base='https://www.googleapis.com/drive/v3/files/'+ident
    info=json.loads(connection.request(base+'?fields=id,name,mimeType,parents,modifiedTime,trashed&supportsAllDrives=true',token=access))
    if info.get('trashed'):raise ValueError('Dit Drive-bestand staat in de prullenbak. Kies een actuele voucher.')
    if not re.search(r'(?<!\d)'+re.escape(n)+r'[A-Za-z]?(?!\d)',info['name']):raise ValueError('Dit bestand heeft een ander boekingsnummer. Upload het na handmatige controle.')
    if payload.get('updatedAt') and payload['updatedAt']!=info.get('modifiedTime'):raise ValueError('Het Drive-document is gewijzigd. Zoek de documenten opnieuw.')
    folder=payload.get('voucherFolder','')
    if folder and (folder not in voucher_folders() or folder not in info.get('parents',[])):raise ValueError('Deze voucher staat niet meer in de ingestelde hotelvouchermap. Zoek de documenten opnieuw.')
    if info['mimeType']=='application/vnd.google-apps.document':raw=connection.request(base+'/export?mimeType=application%2Fpdf',token=access,limit=30*1024*1024)
    elif info['mimeType']=='application/pdf':raw=connection.request(base+'?alt=media&supportsAllDrives=true',token=access,limit=30*1024*1024)
    else:raise ValueError('Kies een PDF of Google-document.')
    result=store(s,raw,info['name'])
    return {**result,'driveDocument':{'id':ident,'title':info['name'],'updatedAt':info.get('modifiedTime',''),**({'voucherFolder':folder} if folder else {})}}
