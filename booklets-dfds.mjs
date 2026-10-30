// Customer confirmations only. Never follow agent, payment or booking-management links.
import {decodeEntities,plainHTML} from './flora-mail-source.mjs';
import {safeDFDSURL} from './flora-dfds.mjs';

export function dfdsReference(value){
 const match=String(value||'').trim().match(/^(?:DFDS\s*[:#-]?\s*)?(\d{6,10})(?:-\d{1,3})?$/i);
 return match?.[1]||'';
}
export function dfdsTodoReferences(todo){
 if(!/\bDFDS\b/i.test((todo.title||'')+' '+(todo.description||'')))return [];
 const field=String(todo.supplierBookingNumber||'').trim();
 if(field)return [...new Set(field.split(/[,;|/]/).map(dfdsReference).filter(Boolean))];
 return [...new Set([...String(todo.description||'').matchAll(/\bDFDS\s*(?:boekingsnummer|booking(?: number)?|referentie)?\s*[:#-]\s*(\d{6,10})(?:-\d{1,3})?\b/gi)].map(m=>m[1]))];
}
export function dfdsReferences(booking){
 return [...new Set([...(booking.todos||[]).flatMap(dfdsTodoReferences),...[...String(booking.notes||'').matchAll(/\bDFDS\s*(?:boekingsnummer|booking(?: number)?|referentie)?\s*[:#-]\s*(\d{6,10})(?:-\d{1,3})?\b/gi)].map(m=>m[1])])];
}
export function dfdsMessageReferences(subject,text){
 const refs=[];
 const match=String(subject).match(/^(?:Bedankt voor je boeking!?|Je boeking is (?:gewijzigd|geannuleerd))\s*[-–:#]\s*(\d{6,10})(?:-\d{1,3})?\s*$/i);
 if(match)refs.push(match[1]);
 for(const m of String(text).matchAll(/\b(?:boekingsnummer|booking number|booking reference)\s*[:#]?\s*(\d{6,10})(?:-\d{1,3})?\b/gi))refs.push(m[1]);
 const unique=[...new Set(refs)];
 return unique.length===1?unique:[];
}
export function dfdsCustomerLinks(html){
 const links=[...String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .filter(m=>/\b(?:klant|customer|passenger)\b/i.test(plainHTML(m[2]))&&!/\bagent\b/i.test(plainHTML(m[2]))&&/boekingsbevestiging|booking confirmation/i.test(plainHTML(m[2])))
  .map(m=>decodeEntities(m[1])).filter(safeDFDSURL);
 const unique=[...new Set(links)];
 return unique.length===1?unique:[];
}
export function dfdsCustomerAttachment(filename){
 return /\.pdf$/i.test(filename)&&/\b(?:klant|customer|passenger)\b/i.test(filename.replaceAll('_',' '))&&/dfds|booking|confirmation|bevestiging|itinerary/i.test(filename)&&!/agent|invoice|factuur|receipt|refund/i.test(filename);
}
