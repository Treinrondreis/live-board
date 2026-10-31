// Supplier-specific proof; search results alone never authorize an attachment.
export const extraProviders={ratehawk:{name:'RateHawk',domain:'ratehawk.com'},ltg:{name:'LTG Link',domain:'ltglink.lt'},renfe:{name:'RENFE',domain:'renfe.es'},snalltaget:{name:'Snälltåget',domain:'snalltaget.se'}};
export const extraPatterns={ratehawk:/^\d{9}$/,ltg:/^\d{12}$/,renfe:/^[A-Z0-9]{6}$/,snalltaget:/^[A-Z0-9]{6}$/};
const normal=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
export function extraTodoReferences(todo,provider){
 const title=(todo.title||'')+' '+(todo.description||'');
 if(provider==='ratehawk'){
  if(!/ratehawk/i.test(title)&&(!todo.startDate||!todo.endDate||todo.endDate<=todo.startDate||/trein|train|ticket|ferry|overtocht|flight|vlucht/i.test(title)))return [];
 }else if(!/trein|train|ticket|rail|renfe|ltg|sn[aä]llt[aå]get/i.test(title))return [];
 const raw=String(todo.supplierBookingNumber||'').replace(/^(?:RateHawk|LTG\s*Link|RENFE|Sn[aä]llt[aå]get)\s*[:#-]?\s*/i,'');
 return [...new Set(raw.split(/[,;|/]/).map(normal).filter(r=>extraPatterns[provider].test(r)))];
}
export function extraAttachmentReferences(name,provider){
 const match=provider==='ratehawk'?name.match(/^voucher-(?:nl|en)-(\d{9})\.pdf$/i):provider==='renfe'?name.match(/^([A-Z0-9]{6})\.pdf$/i):provider==='snalltaget'?name.match(/^([A-Z0-9]{6})_\d+\.pdf$/i):null;
 return match?[normal(match[1])]:[];
}
export function extraMessageReferences(provider,subject,text,names=[]){
 const refs=new Set(names.flatMap(n=>extraAttachmentReferences(n,provider))),source=subject+'\n'+text;
 const pattern=provider==='ratehawk'?/(?:boekingsreferentie|boeking|reservering|booking(?:\s+(?:reference|number))?|reservation(?:\s+(?:number|no\.?))?)\s*[:#]?\s*(\d{9})\b/gi:
 provider==='ltg'?/(?:booking\s+number|e\.?\s*ticket\s*(?:nr\.?|no\.?))\s*[:#]?\s*(\d{12})\b/gi:
 provider==='renfe'?/\b(?:localizador|booking reference)\s*[:#]?\s*([A-Z0-9]{6})\b/gi:
 /(?:reservation number|booking reference|reservation from Sn[aä]llt[aå]get\.se)\s*[:#]?\s*([A-Z0-9]{6})\b/gi;
 for(const m of source.matchAll(pattern))refs.add(normal(m[1]));
 return [...refs];
}
export function extraAttachment(name,provider){
 if(!/\.pdf$/i.test(name)||/invoice|receipt|factuur|refund|_rcp\b/i.test(name))return false;
 if(provider==='ltg')return /^tickets?\.pdf$/i.test(name);
 return extraAttachmentReferences(name,provider).length>0;
}
export function preferredExtraAttachments(parts,provider){
 if(provider!=='ratehawk')return parts;
 // Language alternatives of the same voucher are one document, not two stays.
 return parts.filter(p=>!/^voucher-en-/i.test(p.filename)||!parts.some(q=>q.filename.toLowerCase()===p.filename.toLowerCase().replace('voucher-en-','voucher-nl-')));
}
