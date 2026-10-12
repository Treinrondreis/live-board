"""Personal train screen: original photograph, vector lettering, immutable PDFs."""
import io, json, re, time
from pathlib import Path
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.utils import ImageReader
import ticket_dates

BLUE='#174D81'
TIME=r'(?:[01]\d|2[0-3]):[0-5]\d'
DATE=r'(?:\d{1,2}[.]\d{1,2}[.](?:20\d{2})?|20\d{2}-\d{2}-\d{2})'

def text(value,limit=120):
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 and c!='\n' for c in value):
        raise ValueError('Tekst voor het treinscherm is te lang of ongeldig.')
    return value.strip()

def settings(b):
    if b.get('mode','roundtrip') not in ('roundtrip','circuit'):raise ValueError('Kies heen/terug of rondreis.')
    if b.get('format','A5') not in ('A4','A5'):raise ValueError('Kies A4 of A5.')
    if type(b.get('showDates',False)) is not bool:raise ValueError('Kies wel of geen datums.')
    cfg={k:text(b.get(k,v),n) for k,v,n in [('title','Stedentrip Wenen',80),('heading','Treinreis naar',50),('subtitle','Met de nachttrein',50),('train','Nightjet',50)]}
    if not cfg['title']:raise ValueError('Vul een titel in.')
    cfg.update(mode=b.get('mode','roundtrip'),format=b.get('format','A5'),showDates=b.get('showDates',False))
    legs=b.get('legs',[])
    if not isinstance(legs,list) or len(legs)!=2:raise ValueError('Vul twee ritten in: heenreis en terugreis.')
    cfg['legs']=[]
    for leg in legs:
        if not isinstance(leg,dict):raise ValueError('Ongeldige rit.')
        result={k:text(leg.get(k,''),80) for k in ['departureStation','arrivalStation','departureTime','arrivalTime','departureDate','arrivalDate']}
        for k in ('departureTime','arrivalTime'):
            if result[k] and not re.fullmatch(TIME,result[k]):raise ValueError('Gebruik tijden als 19:58.')
        for k in ('departureDate','arrivalDate'):
            if result[k] and ticket_dates.iso(result[k])!=result[k]:raise ValueError('Gebruik een geldige reisdatum.')
        if cfg['mode']=='roundtrip' and any(not result[k] for k in ('departureStation','arrivalStation','departureTime','arrivalTime')):raise ValueError('Vul beide stations en tijden per rit in. Datums zijn optioneel.')
        cfg['legs'].append(result)
    destinations=b.get('destinations',[])
    if not isinstance(destinations,list) or len(destinations)>6:raise ValueError('Gebruik twee tot zes bestemmingen.')
    cfg['destinations']=[text(v,70) for v in destinations if v]
    if cfg['mode']=='circuit' and not 2<=len(cfg['destinations'])<=6:raise ValueError('Vul twee tot zes bestemmingen voor de rondreis in.')
    return cfg

def parse_ticket(raw):
    """Only explicit timetable endpoints. Never infer from unrelated clock/date text."""
    raw=raw[:100000].replace('\u00a0',' ')
    stamp=rf'(?:(?P<{{prefix}}Date>{DATE})[ \t]+)?(?P<{{prefix}}Time>{TIME})[ \t]+(?P<{{prefix}}Station>[^\n]{{2,80}}?)'
    pattern=r'(?m)^[ \t]*'+stamp.replace('{prefix}','departure')+r'[ \t]*(?:->|→|–>|=>)[ \t]*'+stamp.replace('{prefix}','arrival')+r'(?=\n|$)'
    found=[]
    for m in re.finditer(pattern,raw):
        d=m.groupdict()
        for k in ('departureDate','arrivalDate'):d[k]=ticket_dates.iso(d[k]) or ''
        for k in ('departureStation','arrivalStation'):d[k]=d[k].strip()
        found.append(d)
    # Labelled rows are equally explicit and are common on reservation PDFs.
    row=rf'(?im)^\s*(departure|abfahrt|vertrek|arrival|ankunft|aankomst)\s*:\s*(.*?)\s+(?:({DATE})\s+)?({TIME})\s*$'
    start=None
    for m in re.finditer(row,raw):
        if not m[2].strip():continue
        data={'Station':m[2].strip(),'Date':ticket_dates.iso(m[3]) or '','Time':m[4]}
        if m[1].lower() in ('departure','abfahrt','vertrek'):start=data
        elif start:
            found.append({**{'departure'+k:v for k,v in start.items()},**{'arrival'+k:v for k,v in data.items()}});start=None
    return found

def inspect(s,b):
    pages=b.get('pages',[])
    if not isinstance(pages,list) or not 1<=len(pages)<=50:raise ValueError('Kies één tot vijftig ticketpagina’s.')
    candidates=[];seen=set();readers={};deadline=time.monotonic()+20
    for p in pages:
        if not isinstance(p,dict) or not re.fullmatch('[a-f0-9]{32}',str(p.get('asset',''))) or type(p.get('page')) is not int:raise ValueError('Ongeldige ticketpagina.')
        ident=p['asset'];meta=s.asset(ident)
        if not 0<=p['page']<meta['pages']:raise ValueError('Ticketpagina bestaat niet.')
        if time.monotonic()>deadline:raise ValueError('Ticketcontrole duurt te lang. Kies minder pagina’s.')
        if ident not in readers:readers[ident]=PdfReader(s.DATA/'pdfs'/(ident+'.pdf'))
        for leg in parse_ticket(readers[ident].pages[p['page']].extract_text() or ''):
            key=tuple(leg.values())
            if key not in seen:
                seen.add(key);candidates.append({**leg,'sourceAsset':ident,'sourcePage':p['page']})
    return {'candidates':candidates,'message':'Controleer stations, tijden en richting voordat u de PDF maakt.' if candidates else 'Geen eenduidige rit herkend. Vul de stations en tijden handmatig in; er worden geen tijden gegokt.'}

def pdf(s,cfg):
    W,H=s.SIZES[cfg['format']];buf=io.BytesIO();c=canvas.Canvas(buf,pagesize=(W,H));c.setTitle(cfg['title']);c.setAuthor('Treinrondreis')
    # Crop placement only: retain the full original 6000 x 4002 image in the PDF.
    crop=(1090,265,620,990) if cfg['format']=='A4' else (900,310,860,606)
    x,y,w,h=crop;scale=max(W/w,H/h);ox=(W-w*scale)/2-x*scale;oy=(H-h*scale)/2-y*scale
    c.saveState();c.translate(ox,H-oy);c.scale(scale,-scale)
    c.saveState();c.translate(0,1279);c.scale(1,-1)
    c.drawImage(ImageReader(str(Path(__file__).parent/'brand/treinreis-interieur.jpg')),0,0,width=1919,height=1279)
    c.restoreState()
    def polygon(points,color):
        c.setFillColor(color);p=c.beginPath();p.moveTo(*points[0])
        for pt in points[1:]:p.lineTo(*pt)
        p.close();c.drawPath(p,fill=1,stroke=0)
    polygon([(1228,365),(1527,362),(1526,889),(1228,888)],'#C5CFD8')
    polygon([(1228,365),(1527,362),(1527,441),(1228,444)],'#0D3D75')
    def label(value,x,y,size=24,bold=False,color=BLUE,width=270):
        name='Booklet-Bold' if bold else 'Booklet'
        size=min(size,size*width/max(1,pdfmetrics.stringWidth(value,name,size)))
        if size<13:raise ValueError('Deze tekst is te lang voor het scherm. Verkort de titel of stationsnaam.')
        c.saveState();c.translate(x,y);c.scale(1,-1);c.setFillColor(color);c.setFont(name,size);c.drawString(0,0,value);c.restoreState()
    label(cfg['heading'],1240,389,21,color='#EDF1F4')
    label(cfg['title'],1240,428,35,True,'#EDF1F4')
    label(cfg['subtitle'],1240,468,20)
    label(cfg['train'],1240,506,31,True)
    def route(ys):
        c.setStrokeColor(BLUE);c.setLineWidth(4.5);c.line(1322,ys[0]-22,1322,ys[-1]-16)
        for yy in ys[:-1]:c.line(1322,yy-6,1334,yy-6)
        c.circle(1322,ys[-1]-6,10,stroke=1,fill=0)
    if cfg['mode']=='roundtrip':
        for i,(head,top) in enumerate([('HEENREIS',545),('TERUGREIS',711)]):
            leg=cfg['legs'][i];label(head,1240,top,17,True);ys=[top+47,top+107];route(ys)
            for prefix,yy in zip(['departure','arrival'],ys):
                label(leg[prefix+'Time'],1240,yy,22,width=75)
                label(leg[prefix+'Station'],1348,yy,23,True,width=165)
                if cfg['showDates'] and leg[prefix+'Date']:label(leg[prefix+'Date'],1348,yy+20,13,width=165)
            if i==0:c.setStrokeColor('#96AAB9');c.setLineWidth(.8);c.line(1240,681,1513,681)
    else:
        label('UW RONDREIS',1240,548,17,True)
        stations=cfg['destinations'];ys=[591+i*260/max(1,len(stations)-1) for i in range(len(stations))];route(ys)
        for name,yy in zip(stations,ys):label(name,1348,yy,25,True,width=165)
    c.restoreState();c.showPage();c.save();return buf.getvalue()

def render(s,b):
    cfg=settings(b);raw=pdf(s,cfg);reader,meta=s.inspect_pdf(raw);ident=s.ident();s.ensure_capacity(len(raw))
    (s.DATA/'pdfs'/(ident+'.pdf')).write_bytes(raw)
    with s.db() as db:db.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,cfg['title'],len(reader.pages),json.dumps(meta),s.now()))
    return {'asset':ident,'title':cfg['title'],'pages':1,'format':cfg['format'],'trainScreen':cfg,'url':'/files/asset/'+ident}
