"""Compare included document source pages, including identical PDF uploads."""
import hashlib
from features import document_condition

def warnings(s,body):
    seen={};digests={};result=[]
    for slot in body.get('sections',[]):
        if document_condition(slot,body) is False:continue
        sec=slot.get('selected') if slot.get('choice') else slot
        if not sec or not (slot.get('choice')=='document' or sec.get('oneOff') and not sec.get('trainScreen')):continue
        if not sec.get('pageSources') and (not sec.get('asset') or type(sec.get('pages')) is not int):continue
        pages=sec.get('pageSources') or [dict(asset=sec['asset'],page=n) for n in range(sec['pages'])]
        for n,page in enumerate(pages):
            ident=page.get('asset');index=page.get('page')
            try:
                meta=s.asset(ident)
                if type(index) is not int or not 0<=index<meta['pages']:continue
                if ident not in digests:digests[ident]=hashlib.sha256((s.DATA/'pdfs'/(ident+'.pdf')).read_bytes()).hexdigest()
            except (ValueError,TypeError,FileNotFoundError):continue
            key=(digests[ident],index);location=(slot.get('title') or sec.get('title') or 'Document')+', pagina '+str(n+1)
            if key in seen:result.append('Dubbele documentpagina: '+seen[key]+' en '+location+'. Controleer of beide nodig zijn.')
            else:seen[key]=location
    return list(dict.fromkeys(result))
