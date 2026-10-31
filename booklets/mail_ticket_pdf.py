"""Print original supplier ticket HTML with original raster barcodes, offline."""
import base64,hashlib,html,io,json,re,subprocess,sys
from html.parser import HTMLParser
from PIL import Image

class TicketHTML(HTMLParser):
    tags=set('html head body style table tbody thead tfoot tr td th div span p br hr b strong i em u h1 h2 h3 h4 ul ol li img a font center'.split())
    attrs=set('class id colspan rowspan cellpadding cellspacing border align valign bgcolor color face size width height style'.split())
    def __init__(self,images):super().__init__(convert_charrefs=True);self.images=images;self.out=[];self.skip=0;self.used=set()
    def handle_starttag(self,tag,attrs):
        if tag in ('script','iframe','object','svg','form','textarea'):self.skip+=1;return
        if self.skip or tag not in self.tags:return
        a=dict(attrs)
        # Email layout tables can contain a whole ticket in one unbreakable
        # row. Flow their cells in source order so every part can paginate.
        if tag in ('table','tbody','thead','tfoot','tr','td','th'):
            self.out.append('<div>');return
        if tag=='img':
            src=a.get('src','')
            if src not in self.images:return
            self.used.add(src)
            width=a.get('width','');width_attr=' width="'+width+'"' if re.fullmatch(r'\d{1,3}',width) and 1<=int(width)<=600 else ''
            self.out.append('<img src="'+self.images[src]+'"'+width_attr+' style="max-width:100%;height:auto">');return
        safe=[]
        for k,v in attrs:
            if k not in self.attrs or v is None:continue
            if k=='style' and re.search(r'url\s*\(|@|\\|expression|image-set',v,re.I):continue
            if k in ('width','height') and (not re.fullmatch(r'\d{1,3}%?',v) or int(v.rstrip('%'))>600):continue
            safe.append(k+'="'+html.escape(v,quote=True)+'"')
        self.out.append('<'+tag+(' '+' '.join(safe) if safe else '')+'>')
    def handle_endtag(self,tag):
        if tag in ('script','iframe','object','svg','form','textarea'):self.skip=max(0,self.skip-1);return
        if not self.skip and tag in ('table','tbody','thead','tfoot','tr','td','th'):
            self.out.append('</div>');return
        if not self.skip and tag in self.tags and tag not in ('img','br','hr'):self.out.append('</'+tag+'>')
    def handle_data(self,data):
        if self.skip:return
        if self.lasttag=='style':
            if not re.search(r'url\s*\(|@import|@font-face|\\|expression',data,re.I):self.out.append(data)
        else:self.out.append(html.escape(data))

def make_pdf(payload):
    import pymupdf
    if payload.get('provider') not in ('citylink','eurostar','gonordic'):raise ValueError('Onbekende ticketmail.')
    source=payload.get('html','');images=payload.get('images',[])
    if not isinstance(source,str) or not 1<=len(source)<=700000 or not isinstance(images,list) or len(images)>30:raise ValueError('Ticketmail te groot.')
    archive=pymupdf.Archive();mapping={};required=set();expected=set()
    for n,image in enumerate(images):
        if not isinstance(image,dict) or not isinstance(image.get('src'),str) or image['src'] in mapping:raise ValueError('Ongeldige ticketafbeelding.')
        encoded=image.get('data','')
        if not isinstance(encoded,str) or len(encoded)>3*1024*1024:raise ValueError('Ticketafbeelding te groot.')
        raw=base64.b64decode(encoded,validate=True)
        with Image.open(io.BytesIO(raw)) as im:
            if im.format not in ('PNG','JPEG') or im.width*im.height>4000000:raise ValueError('Ongeldige ticketafbeelding.')
            im.verify()
        name=f'image{n}.png';archive.add((raw,name));mapping[image['src']]=name
        if image.get('required'):
            required.add(image['src'])
            with Image.open(io.BytesIO(raw)) as im:expected.add((im.size,hashlib.sha256(im.convert('RGB').tobytes()).hexdigest()))
    if payload['provider'] in ('citylink','eurostar') and not required:raise ValueError('De originele ticketbarcode ontbreekt.')
    parser=TicketHTML(mapping);parser.feed(source);parser.close()
    if not required.issubset(parser.used):raise ValueError('Niet alle ticketbarcodes staan in de ticketmail.')
    clean=''.join(parser.out)
    story=pymupdf.Story(html=clean,user_css='body {font-family:sans-serif;font-size:9pt;} div {margin:0!important;padding:0!important;} p {margin:3pt 0!important;} h1,h2,h3,h4 {margin:6pt 0!important;} table {max-width:100%;} img {max-width:100%;} td,th {overflow-wrap:break-word;}',archive=archive)
    output=io.BytesIO();writer=pymupdf.DocumentWriter(output);more=True;pages=0
    while more:
        pages+=1
        if pages>30:raise ValueError('Ticketmail heeft te veel pagina’s.')
        device=writer.begin_page(pymupdf.Rect(0,0,595.28,841.89));more,filled=story.place(pymupdf.Rect(24,24,571.28,817.89));story.draw(device);writer.end_page()
    writer.close();raw=output.getvalue()
    # Reject a render that silently dropped a required barcode.
    document=pymupdf.open(stream=raw,filetype='pdf')
    actual=set()
    for xref in {entry[0] for page in document for entry in page.get_images()}:
        data=document.extract_image(xref)['image']
        with Image.open(io.BytesIO(data)) as im:actual.add((im.size,hashlib.sha256(im.convert('RGB').tobytes()).hexdigest()))
    if not expected.issubset(actual):raise ValueError('Niet alle originele barcodes konden ongewijzigd worden afgedrukt.')
    return raw

def render(s,payload):
    import booking_documents
    encoded=json.dumps(payload).encode()
    if len(encoded)>12*1024*1024:raise ValueError('Ticketmail te groot.')
    try:result=subprocess.run([sys.executable,__file__],input=encoded,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
    except subprocess.TimeoutExpired:raise ValueError('Ticketmail afdrukken duurt te lang. Download de ticket-PDF bij de leverancier.')
    if result.returncode or not result.stdout.startswith(b'%PDF-') or len(result.stdout)>20*1024*1024:raise ValueError('De ticketmail kon niet volledig worden afgedrukt. Download de originele ticket-PDF bij de leverancier.')
    return {**booking_documents.store(s,result.stdout,payload.get('title','Ticketmail')),'sourceDigest':hashlib.sha256(encoded).hexdigest()}

if __name__=='__main__':
    try:
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_AS,(768*1024*1024,768*1024*1024));resource.setrlimit(resource.RLIMIT_CPU,(20,20))
        except ImportError:pass
        data=sys.stdin.buffer.read(12*1024*1024+1)
        if len(data)>12*1024*1024:raise ValueError()
        sys.stdout.buffer.write(make_pdf(json.loads(data)))
    except Exception:sys.exit(1)
