"""Render a booking letter in Treinrondreis style, retaining source block order."""
import io,re
from pathlib import Path
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from features import SIZES

VERSION='treinrondreis-letter-1'
VOUCHER_VERSION='treinrondreis-voucher-1'
COLUMNS_VERSION='treinrondreis-letter-columns-2'
LOGO=Path(__file__).parent/'brand'/'treinrondreis-logo.png'
CONTACT=('Treinrondreis.nl','Grondherendijk 41 a/b','3082 DG Rotterdam','010 - 2613043','contact@treinrondreis.nl')

def render(model,images,fmt,kind='letter',layout='text'):
    voucher=kind=='voucher'
    columns=layout=='columns' and not voucher
    width,height=SIZES[fmt]
    margin,top,bottom=(76.5,136,68) if fmt=='A4' else (30,87,56)
    if columns:margin,top,bottom=25*mm,25*mm+42,25*mm+126*64/432+12
    usable=width-2*margin
    available=height-top-bottom
    color='#000000' if columns else '#1A1A1A'
    normal=ParagraphStyle('letter',fontName='Booklet',fontSize=10,leading=16.5 if columns else 14.5 if fmt=='A4' else 13.5,textColor=color,spaceAfter=8 if fmt=='A4' else 6,allowWidows=0,allowOrphans=0)
    heading=ParagraphStyle('letter-heading',parent=normal,fontName='Booklet-Bold',fontSize=11,leading=18.15 if columns else 15.95 if fmt=='A4' else 15,spaceBefore=10 if fmt=='A4' else 6,spaceAfter=5 if fmt=='A4' else 4,keepWithNext=True)
    address=ParagraphStyle('letter-address',parent=normal,spaceAfter=24,keepWithNext=True)
    hotel_heading=ParagraphStyle('voucher-hotel',parent=heading,fontSize=12,leading=17,spaceBefore=4)
    blocks=model['blocks']
    # The address comes from the document itself; never invent or duplicate customer fields.
    first_address=bool(not columns and len(blocks)>1 and blocks[0]['type']=='text' and not blocks[0].get('heading') and '<br/>' in blocks[0]['html'] and blocks[1]['type']=='text' and blocks[1].get('plain','').lstrip().startswith(('Beste ','Geachte ','Dear ')))

    def flows(items,w,depth=0):
        if depth>8:raise ValueError('De brief bevat te diep geneste tabellen.')
        result=[]
        for index,b in enumerate(items):
            if b['type']=='pageBreak':
                result.append(PageBreak())
            elif b['type']=='text':
                is_heading=b.get('heading') or (not b.get('bullet') and len(b.get('plain',''))<120 and re.fullmatch(r'(?:\s*<b>.*?</b>\s*)+',b['html'],re.S))
                style=address if first_address and b is blocks[0] else heading if is_heading else normal
                if voucher and b.get('sourceStyle')=='h2':style=hotel_heading
                if b.get('bullet'):
                    indent=12*b.get('bulletLevel',1)
                    style=ParagraphStyle('letter-list',parent=style,leftIndent=indent,bulletIndent=indent-12,bulletFontName='Booklet',bulletFontSize=10,spaceAfter=4)
                if index+1<len(items) and items[index+1]['type']=='image' and 'QR' in b.get('plain',''):
                    style=ParagraphStyle('letter-image-caption',parent=style,keepWithNext=True)
                paragraph=Paragraph(b['html'].strip(),style,bulletText=b.get('bullet') or None)
                if b.get('plain','').lstrip().startswith(('Hartelijke groeten','Met vriendelijke groet')):
                    result.append(KeepTogether([paragraph]))
                else:result.append(paragraph)
            elif b['type']=='image':
                scale=min(w/b['width'],(available-24)/b['height'],1)
                image=Image(io.BytesIO(images[b['key']]),width=b['width']*scale,height=b['height']*scale)
                image.hAlign='LEFT'
                result.extend([image,Spacer(1,10)])
            elif b['type']=='table':
                columns=max((len(row) for row in b['rows']),default=0)
                if not 1<=columns<=8:raise ValueError('Een tabel in de brief moet één tot acht kolommen hebben.')
                widths=[min(150,w*.38),w-min(150,w*.38)] if voucher and columns==2 else [w/columns]*columns
                rows=[]
                for row in b['rows']:
                    cells=[]
                    for col,cell in enumerate(row):
                        if voucher and col==0:cell=[{**item,'html':'<b>'+item['html']+'</b>'} if item['type']=='text' else item for item in cell]
                        cells.append(flows(cell,widths[col]-8,depth+1))
                    rows.append(cells+['']*(columns-len(row)))
                table=Table(rows,colWidths=widths,hAlign='LEFT',repeatRows=0 if voucher else 1)
                commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0 if voucher else 6),('RIGHTPADDING',(0,0),(-1,-1),8 if voucher else 6)]
                if not voucher:commands.append(('GRID',(0,0),(-1,-1),.4,'#bbbbbb'))
                table.setStyle(TableStyle(commands))
                result.extend([table,Spacer(1,10)])
            else:raise ValueError('Niet ondersteund onderdeel in de brief.')
        return result

    def stationery(canvas,doc):
        canvas.saveState()
        canvas.setFillColor(color)
        logo_width=126 if fmt=='A4' else 110
        logo_height=logo_width*64/432
        header_top=76.5 if fmt=='A4' else 30
        canvas.drawImage(ImageReader(str(LOGO)),margin,height-header_top-logo_height,width=logo_width,height=logo_height,mask='auto')
        canvas.setFont('Booklet',6.8)
        for i,line in enumerate(CONTACT):
            canvas.drawRightString(width-margin,height-header_top-7-i*10,line)
        canvas.setFont('Booklet',6.7)
        for i,line in enumerate(('KvK: 86245007','BTW: NL863908019B01','www.treinrondreis.nl')):
            canvas.drawRightString(width-margin,42-i*9,line)
        canvas.restoreState()

    buffer=io.BytesIO()
    doc=BaseDocTemplate(buffer,pagesize=(width,height),leftMargin=margin,rightMargin=margin,topMargin=top,bottomMargin=bottom,title=model['title'],author='Treinrondreis')
    if columns:
        gap=8*mm;column_width=(usable-gap)/2
        title=Paragraph('Belangrijke Informatie',ParagraphStyle('information-title',fontName='Montserrat-Bold',fontSize=22,leading=28,textColor=color))
        def footer(canvas,doc):
            canvas.drawImage(ImageReader(str(LOGO)),margin,margin,width=126,height=126*64/432,mask='auto')
        def first_page(canvas,doc):
            footer(canvas,doc);title.wrap(usable,height);title.drawOn(canvas,margin,height-margin-28)
        def frames(frame_top):
            return [Frame(margin+n*(column_width+gap),bottom,column_width,height-frame_top-bottom,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0) for n in range(2)]
        doc.addPageTemplates([PageTemplate(id='information-first',frames=frames(top),onPage=first_page,autoNextPageTemplate='information-next'),PageTemplate(id='information-next',frames=frames(margin),onPage=footer)])
        story=flows(blocks,column_width)
    else:
        frame=Frame(margin,bottom,usable,available,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
        doc.addPageTemplates(PageTemplate(id='letter',frames=[frame],onPage=stationery))
        story=flows(blocks,usable)
    try:doc.build(story)
    except Exception as e:
        from reportlab.platypus.doctemplate import LayoutError
        if isinstance(e,LayoutError):raise ValueError('Een alinea of tabel in de brief past niet op de pagina. Pas dit onderdeel in de brontekst aan of gebruik de originele PDF.') from None
        raise
    return buffer.getvalue()
