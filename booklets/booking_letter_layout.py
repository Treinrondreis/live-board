"""Render a booking letter in Treinrondreis style, retaining source block order."""
import io,re
from pathlib import Path
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from features import SIZES

VERSION='treinrondreis-letter-1'
LOGO=Path(__file__).parent/'brand'/'treinrondreis-logo.png'
CONTACT=('Treinrondreis.nl','Grondherendijk 41 a/b','3082 DG Rotterdam','010 - 2613043','contact@treinrondreis.nl')

def render(model,images,fmt):
    width,height=SIZES[fmt]
    margin,top,bottom=(76.5,136,68) if fmt=='A4' else (30,87,56)
    usable=width-2*margin
    available=height-top-bottom
    color='#1A1A1A'
    normal=ParagraphStyle('letter',fontName='Booklet',fontSize=10,leading=14.5 if fmt=='A4' else 13.5,textColor=color,spaceAfter=8 if fmt=='A4' else 6,allowWidows=0,allowOrphans=0)
    heading=ParagraphStyle('letter-heading',parent=normal,fontName='Booklet-Bold',fontSize=11,leading=15.95 if fmt=='A4' else 15,spaceBefore=10 if fmt=='A4' else 6,spaceAfter=5 if fmt=='A4' else 4,keepWithNext=True)
    address=ParagraphStyle('letter-address',parent=normal,spaceAfter=24,keepWithNext=True)
    blocks=model['blocks']
    # The address comes from the document itself; never invent or duplicate customer fields.
    first_address=bool(len(blocks)>1 and blocks[0]['type']=='text' and not blocks[0].get('heading') and '<br/>' in blocks[0]['html'] and blocks[1]['type']=='text' and blocks[1].get('plain','').lstrip().startswith(('Beste ','Geachte ','Dear ')))

    def flows(items,w,depth=0):
        if depth>8:raise ValueError('De brief bevat te diep geneste tabellen.')
        result=[]
        for index,b in enumerate(items):
            if b['type']=='pageBreak':
                result.append(PageBreak())
            elif b['type']=='text':
                is_heading=b.get('heading') or (not b.get('bullet') and len(b.get('plain',''))<120 and re.fullmatch(r'(?:\s*<b>.*?</b>\s*)+',b['html'],re.S))
                style=address if first_address and b is blocks[0] else heading if is_heading else normal
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
                rows=[[flows(cell,w/columns-12,depth+1) for cell in row]+['']*(columns-len(row)) for row in b['rows']]
                table=Table(rows,colWidths=[w/columns]*columns,hAlign='LEFT',repeatRows=1)
                table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.4,'#bbbbbb'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]))
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
    frame=Frame(margin,bottom,usable,available,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id='letter',frames=[frame],onPage=stationery))
    try:doc.build(flows(blocks,usable))
    except Exception as e:
        from reportlab.platypus.doctemplate import LayoutError
        if isinstance(e,LayoutError):raise ValueError('Een alinea of tabel in de brief past niet op de pagina. Pas dit onderdeel in de brontekst aan of gebruik de originele PDF.') from None
        raise
    return buffer.getvalue()
