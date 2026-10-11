"""Compose chosen ticket pages in user order, preserving original PDF assets."""
import io,json
from pypdf import PdfReader,PdfWriter,Transformation
from pdf_geometry import normalize_page

def compose(s,payload):
    fmt=payload.get('format','A4');pages=payload.get('pages')
    if fmt not in s.SIZES:raise ValueError('Kies A4 of A5 voor tickets.')
    if not isinstance(pages,list) or not 1<=len(pages)<=100:raise ValueError('Kies één tot honderd ticketpagina’s.')
    width,height=s.SIZES[fmt];writer=PdfWriter();readers={};scaled=False
    for item in pages:
        if not isinstance(item,dict) or type(item.get('page')) is not int:raise ValueError('Ongeldige ticketpagina.')
        ident=item.get('asset');a=s.asset(ident);n=item['page']
        if not 0<=n<a['pages']:raise ValueError('Ticketpagina bestaat niet.')
        if ident not in readers:readers[ident]=PdfReader(s.DATA/'pdfs'/f'{ident}.pdf')
        page=readers[ident].pages[n];normalize_page(page);w,h=float(page.mediabox.width),float(page.mediabox.height)
        if abs(w-width)<3 and abs(h-height)<3:writer.add_page(page)
        else:
            scale=min((width-20)/w,(height-20)/h);scaled=scaled or scale<.95
            target=writer.add_blank_page(width=width,height=height)
            target.merge_transformed_page(page,Transformation().scale(scale).translate((width-w*scale)/2,(height-h*scale)/2))
    stream=io.BytesIO();writer.write(stream);raw=stream.getvalue();reader,meta=s.inspect_pdf(raw);s.ensure_capacity(len(raw));ident=s.ident()
    (s.DATA/'pdfs'/f'{ident}.pdf').write_bytes(raw)
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,'Treintickets',len(reader.pages),json.dumps(meta),s.now()))
    return {'asset':ident,'pages':len(reader.pages),'format':fmt,'scaled':scaled}
