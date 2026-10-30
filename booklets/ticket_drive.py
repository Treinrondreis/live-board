"""Import original ticket PDFs staged in Drive; never contact issuance portals."""
import json,re
from urllib.parse import urlencode
import google_connection as connection
import booking_documents

PROVIDERS={
    'dfds':(r'DFDS',r'\d{6,10}'),
    'ns':(r'NS(?: International)?',r'[A-Z0-9]{6,8}'),
    'mav':(r'M[AÁ]V',r'\d{10}'),
    'db':(r'DB',r'(?:\d{12}|[A-Z0-9]{6})'),
    'obb':(r'(?:ÖBB|OEBB|OBB)',r'(?:\d{16}|[A-Z0-9]{6,8})'),
    'cd':(r'(?:ČD|CD)',r'(?:\d{9,11}|[A-Z0-9]{6})'),
}

def settings(payload):
    provider=payload.get('provider')
    if provider not in PROVIDERS:raise ValueError('Kies een geldige ticketvervoerder.')
    query=re.sub(r'[\s-]','',str(payload.get('query','')).upper())
    if not re.fullmatch(r'[A-Z0-9]{3,18}',query):raise ValueError('Vul een boekingsnummer of vervoerdersreferentie in.')
    refs=payload.get('references',[])
    if not isinstance(refs,list) or len(refs)>20:raise ValueError('Maximaal twintig ticketreferenties.')
    if any(not isinstance(r,str) or not re.fullmatch(PROVIDERS[provider][1],r) for r in refs):raise ValueError('Ongeldige ticketreferentie.')
    return provider,query,list(dict.fromkeys(refs))

def matches(name,term):
    # Canonical filenames separate a reference from the travel date with a space.
    if re.search(r'(?<![A-Z0-9])'+re.escape(term)+r'(?![A-Z0-9])',name.upper()):return True
    return bool(re.search(r'(?<!\d)'+r'[\s-]*'.join(term)+r'(?!\d)',name)) if term.isdigit() else False

def ticket_name(name,provider):
    if not name.lower().endswith('.pdf') or re.search(r'invoice|rechnung|factuur|sz[aá]mla|receipt|bescheinigung|refund|gutschrift|proof',name,re.I):return False
    if provider=='dfds':return bool(re.search(r'\bDFDS\b',name.replace('_',' '),re.I) and re.search(r'\b(klant|customer|passenger)\b',name.replace('_',' '),re.I) and not re.search(r'agent',name,re.I))
    return bool(re.search(r'(?<!\w)'+PROVIDERS[provider][0]+r'(?!\w)|^OEBB[-_ ]?Ticket',name,re.I) and re.search(r'ticket|fahrkarte|j[ií]zdenka|reservierung',name,re.I))

def search(s,payload):
    booking_documents.drive_access(s.DATA)
    provider,query,refs=settings(payload)
    terms=list(dict.fromkeys([query,*refs]));clauses=[]
    for term in terms:
        clauses.append("name contains '"+term+"'")
        if provider=='obb' and re.fullmatch(r'\d{16}',term):clauses.append("name contains '"+' '.join(term[i:i+4] for i in range(0,16,4))+"'")
    args={'q':"trashed = false and mimeType = 'application/pdf' and ("+' or '.join(clauses)+')','fields':'files(id,name,mimeType,modifiedTime),nextPageToken','pageSize':100,'orderBy':'modifiedTime desc','supportsAllDrives':'true','includeItemsFromAllDrives':'true'}
    access=connection.token(s.DATA);items=[];seen=set()
    for page in range(5):
        result=json.loads(connection.request('https://www.googleapis.com/drive/v3/files?'+urlencode(args),token=access))
        for f in result.get('files',[]):
            name=f['name']
            if f.get('mimeType')!='application/pdf' or not ticket_name(name,provider) or not any(matches(name,t) for t in terms):continue
            # Search is newest first: only replace exact duplicate filenames.
            if name.casefold() in seen:continue
            seen.add(name.casefold())
            reference=next((r for r in refs if matches(name,r)),query if re.fullmatch(PROVIDERS[provider][1],query) and matches(name,query) else '')
            items.append({'id':f['id'],'title':name,'updatedAt':f.get('modifiedTime',''),'reference':reference})
        if not result.get('nextPageToken'):break
        args['pageToken']=result['nextPageToken']
    else:raise ValueError('Te veel Drive-ticketbestanden gevonden. Zoek één referentie tegelijk.')
    return {'items':items}

def load(s,payload):
    booking_documents.drive_access(s.DATA)
    provider,query,refs=settings(payload);ident=payload.get('id','')
    if not re.fullmatch(r'[A-Za-z0-9_-]{10,150}',ident):raise ValueError('Ongeldig Drive-ticketbestand.')
    access=connection.token(s.DATA);base='https://www.googleapis.com/drive/v3/files/'+ident
    info=json.loads(connection.request(base+'?fields=id,name,mimeType,modifiedTime,trashed&supportsAllDrives=true',token=access))
    if info.get('trashed') or info.get('mimeType')!='application/pdf' or not ticket_name(info['name'],provider) or not any(matches(info['name'],t) for t in [query,*refs]):raise ValueError('Dit Drive-bestand hoort niet bij deze ticketselectie.')
    if payload.get('updatedAt') and info.get('modifiedTime')!=payload['updatedAt']:raise ValueError('Het Drive-ticket is gewijzigd. Zoek de tickets opnieuw.')
    raw=connection.request(base+'?alt=media&supportsAllDrives=true',token=access,limit=30*1024*1024)
    result=booking_documents.store(s,raw,info['name'])
    return {**result,'driveDocument':{'id':ident,'title':info['name'],'updatedAt':info.get('modifiedTime','')}}
