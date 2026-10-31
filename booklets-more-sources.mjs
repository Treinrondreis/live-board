import {plainHTML,decodeEntities} from './flora-mail-source.mjs';
export const moreProviders={citylink:{name:'Citylink',domain:'citylink.co.uk'},eurostar:{name:'Eurostar',domain:'eurostar.com'},sncf:{name:'SNCF / TER',domain:'sncf-voyageurs.com',domains:['sncf-voyageurs.com','ter-sncf.fr','sncf.fr']},sj:{name:'SJ',domain:'sj.se'},hovertravel:{name:'Hovertravel',domain:'hovertravel.com'},gonordic:{name:'Go Nordic',domain:'gonordiccruiseline.com',allowReplies:true},wightlink:{name:'Wightlink',domain:'wightlink.co.uk'},pkp:{name:'PKP Intercity',domain:'intercity.pl'},zssk:{name:'ZSSK',domain:'slovakrail.sk'},teldar:{name:'Teldar',domain:'teldartravel.com'}};
export const morePatterns={citylink:/^(?:\d{8}|ETS\d{8})$/,eurostar:/^[A-Z0-9]{6}$/,sncf:/^(?:[A-Z0-9]{6}|[A-Z]{2}\d{6})$/,sj:/^[A-Z0-9]{6,10}$/,hovertravel:/^\d{8}$/,gonordic:/^\d{5,8}$/,wightlink:/^\d{8}$/,pkp:/^(?:[A-Z]{2})?\d{8}$/,zssk:/^\d{16}$/,teldar:/^[A-Z0-9]{6}(?:\/\d{1,2})?$/};
export function moreTodoReferences(todo,p){
 const text=(todo.title||'')+' '+(todo.description||'');
 if(p==='teldar'){if(!/teldar/i.test(text)&&(!todo.startDate||!todo.endDate||todo.endDate<=todo.startDate||/trein|train|ticket|ferry|overtocht/i.test(text)))return [];}
 else if(!/trein|train|ticket|rail|eurostar|sncf|\bSJ\b|hover|wightlink|go.?nordic|overtocht|ferry|citylink|\bbus\b|pkp|zssk/i.test(text))return [];
 const raw=String(todo.supplierBookingNumber||'').replace(/^(?:Citylink|Eurostar|SNCF|TER|SJ|Hovertravel|Wightlink|Go\s*Nordic|GNC|PKP|ZSSK|Teldar)\s*[:#-]?\s*/i,'');
 return [...new Set(raw.split(p==='teldar'?/[,;|]/:/[,;|/]/).map(s=>s.trim().toUpperCase().replace(/[\s-]/g,'')).filter(r=>morePatterns[p].test(r)).map(r=>p==='teldar'?r.split('/')[0]:r))];
}
export function moreAttachmentReferences(name,p){
 const m=p==='sj'?name.match(/^([A-Z0-9]{6,10})_\d+\.pdf$/i):p==='hovertravel'||p==='wightlink'?name.match(/^(\d{8})\.pdf$/i):p==='pkp'?name.match(/^Bilet\s*-\s*([A-Z]{2}\d{8})\.pdf$/i):p==='teldar'?name.match(/^([A-Z0-9]{6})~\d{8}_\d{6}_\d+\.pdf$/i):null;
 return m?[m[1].toUpperCase()]:[];
}
export function moreAttachment(name,p){if(!/\.pdf$/i.test(name)||/invoice|receipt|factuur|refund|agent|voucher.*facture/i.test(name))return false;return p==='zssk'?/^ZSSK_ITD_\d+\.pdf$/i.test(name):moreAttachmentReferences(name,p).length>0;}
export function moreMessageReferences(p,subject,text,names=[]){
 const refs=new Set(names.flatMap(n=>moreAttachmentReferences(n,p))),source=subject+'\n'+text;
 const pattern=p==='citylink'?/\b(?:Booking Ref|Ticket No)\s*[:.]?\s*(\d{8}|ETS\d{8})\b/gi:p==='eurostar'?/\bBooking reference\s*[:#]?\s*([A-Z0-9]{6})\b/gi:p==='sncf'?/(?:commande|dossier voyage|r[eé]f[eé]rence(?: de dossier)?)\s*[:#]?\s*([A-Z]{2}\d{6}|[A-Z0-9]{6})\b/gi:p==='sj'?/\bBooking\s*(?:number|no\.?)\s*[:#]?\s*([A-Z0-9]{6,10})\b/gi:p==='pkp'?/\bTICKET NO\s*([A-Z]{2})\s*(\d{8})\b/gi:p==='teldar'?/\b(?:booking|reservation|reservering)\s*[:#]?\s*([A-Z0-9]{6}(?:\/\d{1,2})?)\b/gi:/\b(?:Booking\s*(?:Reference|Ref\.?|number|no\.?)|GNC)\s*[:#]?\s*(\d{5,8})\b/gi;
 for(const m of source.matchAll(pattern)){const r=(p==='pkp'?m[1]+m[2]:m[1]).toUpperCase();if(morePatterns[p].test(r))refs.add(r);}
 if(p==='zssk'&&/\bZSSK\b/.test(source)&&/^\s*TICKET\s*$/m.test(source))for(const m of source.matchAll(/^\s*(?:TČ:\s*)?(\d{16})\b/gm))refs.add(m[1]);
 if(p==='teldar')for(const ref of [...refs])if(ref.includes('/'))refs.add(ref.split('/')[0]);
 return [...refs];
}
export function safeMorePDF(value,p){try{const u=new URL(decodeEntities(value));return p==='sncf'&&u.protocol==='https:'&&u.hostname==='genetix.eto.prod.cdn.vsct.fr'&&!u.port&&!u.username&&!u.password&&!u.hash&&!u.search&&/^\/\d{8,12}\/eto-[a-f\d-]{20,100}$/i.test(u.pathname)?u:null;}catch{return null;}}
export function eurostarBarcode(value,refs){try{const u=new URL(decodeEntities(value)),m=u.pathname.match(/^\/barcode\/([A-Z0-9]{6})\/([A-Za-z0-9_-]{8,100})$/);return u.protocol==='https:'&&u.hostname==='ticket.eurostar.com'&&!u.port&&!u.username&&!u.password&&(!u.search||u.searchParams.getAll('s').length===1&&[...u.searchParams.keys()].every(k=>k==='s')&&/^[A-Za-z0-9_+\/-]{40,100}={0,2}$/.test(u.searchParams.get('s')||''))&&!u.hash&&m&&refs.includes(m[1])?u:null;}catch{return null;}}
export function morePortal(value,p){try{
 let u=new URL(decodeEntities(value));if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return '';
 if(p==='eurostar'&&/^[a-z0-9]+\.r\.eu-west-1\.awstrack\.me$/.test(u.hostname)){const m=u.pathname.match(/^\/L0\/((?:https:|https%3A)[^/]+)/);if(!m)return '';u=new URL(decodeURIComponent(m[1]));}
 if(p==='eurostar'&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&['eurostar.com','www.eurostar.com'].includes(u.hostname)&&/^\/(?:manage-booking|customer-dashboard)\/(?:en|nl|fr)\/booking$/.test(u.pathname)&&/^[A-Z0-9]{6}$/.test(u.searchParams.get('pnr')||''))return 'https://www.eurostar.com'+u.pathname+'?pnr='+u.searchParams.get('pnr');
 }catch{}return '';
}
export function moreLinks(bodies,p){const result=[];for(const body of bodies)for(const m of body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){if(p==='sncf'&&/billet|t[eé]l[eé]charger/i.test(plainHTML(m[2]))){const u=safeMorePDF(m[1],p);if(u)result.push(u.href);}}return [...new Set(result)];}
