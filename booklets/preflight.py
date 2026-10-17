"""Collect all user-fixable field errors before rendering, without writing exports."""
import io
from features import document_condition,omitted_document_warnings
import document_duplicates
import export_checks

def check(s,body,objects,fill=False):
    b=s.refresh_blocks(body,objects);errors=[];missing=[]
    try:b=s.sanity_sources.refresh_export(s,b)
    except ValueError as e:return {'pages':0,'needed':0,'missing':[],'canFill':False,'fillers':[],'warnings':omitted_document_warnings(b),'libraryStamp':s.library_stamp(objects),'errors':[{'section':None,'title':'Sanity-bron','message':str(e)}]}
    def error(index,title,message):errors.append({'section':index,'title':title,'message':str(message)})
    preparation=None
    try:preparation=s.plan(b,objects)
    except ValueError:pass
    if not b.get('sections'):error(None,'Boekje','Voeg eerst een bouwsteen toe.')
    for i,slot in enumerate(b.get('sections',[])):
        export_checks.check()
        if fill and preparation and i in preparation.get('droppedFillerIndices',[]):continue
        condition=document_condition(slot,b)
        if condition is False:continue
        if condition is None:error(i,slot.get('title','Document'),'Controleer eerst de ToDo-voorwaarde van deze documentophaler.');continue
        sec=slot.get('selected') if slot.get('choice') else slot
        if not sec:
            if slot.get('choice')=='document':
                if not slot.get('omitted'):error(i,slot.get('title','Document'),'Haal dit boekingsdocument op, upload een PDF of kies Overslaan / niet van toepassing.')
            else:missing.append(slot.get('title','Keuzepagina'))
            continue
        title=sec.get('title','Bouwsteen')
        try:s.booking_documents.check_slot_layout(slot)
        except ValueError as e:error(i,title,e)
        if sec.get('reviewRequired'):error(i,title,'Controleer de ticketpagina’s en reisdatums voor dit hoofdstuk en bevestig de selectie.' if slot.get('documentKind') in s.booking_documents.TICKET_KINDS else 'Controleer deze voucher en bevestig klant, hotel, datums en reserveringsnummer.')
        try:
            s.validate_body('book',{'format':b.get('format','A4'),'sections':[sec]})
            meta=s.asset(sec['asset'])['meta'];values={**b.get('values',{}),**sec.get('values',{})}
            for f in sec.get('fields',[]):
                try:
                    if f.get('type') in ('contents','pageNumber'):continue
                    value=s.field_text(f,values,title)
                    if not value:continue
                    m=meta[int(f['page'])];_,w,align=s.field_background.text_geometry(f,m['width']);h=m['height']*f['h']/100;size=float(f.get('size',11))
                    if f.get('type') in ('text','prefilled'):
                        flow=s.field_flow.layout(f,value if f['type']=='prefilled' else f['template'],{} if f['type']=='prefilled' else values,w,h,s.TOKEN,s.font_name(f),align)
                        fits=flow['fits']
                    else:fits=len(value.splitlines())*size*1.5<=h and all(s.pdfmetrics.stringWidth(line,s.font_name(f),size)<=w for line in value.splitlines())
                    if not fits:error(i,title,'Pagina '+str(f['page']+1)+': tekst past niet in “'+f['key']+'”.')
                except (ValueError,KeyError,TypeError) as e:error(i,title,e)
        except (ValueError,KeyError,TypeError) as e:error(i,title,e)
    result={'pages':0,'needed':0,'missing':missing,'canFill':False,'fillers':[],'fillRequested':fill,'warnings':omitted_document_warnings(b)+document_duplicates.warnings(s,b),'libraryStamp':s.library_stamp(objects),'errors':errors}
    try:result.update(preparation or s.plan(b,objects))
    except ValueError as e:
        if not errors:error(None,'Boekje',e)
    if not errors:
        export_checks.check()
        try:
            report=s.make_export({'id':'preview','title':'Controle','body':b},{'skipChoices':True,'allowUneven':True,'fill':fill and result['canFill'],'dryRun':True,'libraryStamp':result['libraryStamp']})
            result['checkedPages']=report['report']['pages']
        except (ValueError,KeyError,TypeError) as e:error(None,'PDF-controle',e)
    return result
