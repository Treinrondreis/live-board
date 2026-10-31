export const ferryEnturProviders={finnlines:{name:'Finnlines',domain:'finnlines.com',allowReplies:true},fjordline:{name:'Fjord Line',domain:'fjordline.com'},entur:{name:'Entur',domain:'entur.org'}};
export const ferryEnturPatterns={finnlines:/^F\d{9}$/,fjordline:/^\d{8}$/,entur:/^[A-Z0-9]{8}$/};
const normal=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
export function ferryEnturTodoReferences(todo,provider){
 const text=(todo.title||'')+' '+(todo.description||'');
 const title={finnlines:/finnlines|overtocht|ferry|boot/i,fjordline:/fjord\s*line/i,entur:/entur|trein|train|ticket|\bvy\b/i}[provider];
 if(!title.test(text))return [];
 return [...new Set(String(todo.supplierBookingNumber||'').split(/[,;|/]/).map(normal).filter(r=>ferryEnturPatterns[provider].test(r)&&(provider!=='entur'||/[A-Z]/.test(r))))];
}
export function ferryEnturAttachmentReferences(name,provider){
 const m=provider==='finnlines'?name.match(/^T_(F\d{9})_\d+\.pdf$/i):provider==='fjordline'?name.match(/^(\d{8})\.pdf$/i):name.match(/^(?:tickets?|billetter?)[_-]([A-Z0-9]{8})(?:[_-].*)?\.pdf$/i);
 return m?[normal(m[1])]:[];
}
export function ferryEnturMessageReferences(provider,subject,text,names=[]){
 const refs=new Set(names.flatMap(n=>ferryEnturAttachmentReferences(n,provider))),source=subject+'\n'+text;
 const pattern=provider==='finnlines'?/\b(F\d{9})\b/gi:provider==='fjordline'?/\b(?:Travel Document|Booking(?:\s*(?:number|nbr|no\.?))?)\s*[:#]?\s*(\d{8})\b/gi:/\b(?:Your reference|Reference|Referanse|Ref)\s*[:#]?\s*([A-Z0-9]{8})\b/gi;
 for(const m of source.matchAll(pattern))if(provider!=='entur'||/[A-Z]/i.test(m[1]))refs.add(normal(m[1]));
 return [...refs];
}
export function ferryEnturAttachment(name,provider,subject=''){
 if(!/\.pdf$/i.test(name)||/invoice|factuur|rechnung|refund|receipt|kvittering/i.test(name))return false;
 if(provider==='finnlines')return /^T_F\d{9}_\d+\.pdf$/i.test(name);
 if(provider==='fjordline')return /^\d{8}\.pdf$/i.test(name)&&/Travel Document/i.test(subject)||/^(?:ticket|travel[-_ ]document)[-_ ].*\.pdf$/i.test(name);
 return /^(?:e[-_ ]?)?tickets?(?:[_. -].*)?\.pdf$/i.test(name)||/^billetter?(?:[_. -].*)?\.pdf$/i.test(name);
}
export function ferryEnturDiagnostic(provider,text,names=[]){
 if(provider==='entur'&&(/receipt is not valid as a ticket|kvittering.*ikke.*billett/i.test(text)||names.some(n=>/^sales-receipt-/i.test(n))))return 'Entur: de mail bevat alleen een betalingsbewijs; dit is geen ticket. Download de ticket-PDF uit Entur en upload die hier of voeg hem toe aan de gekoppelde Sanity-boeking.';
 return '';
}
export function ferryCancelled(provider,subject){
 if(provider==='entur')return /refund|cancel(?:led|ed|lation)|geannuleerd|annulering/i.test(subject);
 return /cancel(?:led|ed|lation)|geannuleerd|annulering|storniert/i.test(subject);
}
