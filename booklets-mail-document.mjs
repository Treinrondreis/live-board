import {eurostarBarcode,moreMessageReferences} from './booklets-more-sources.mjs';
import {plainHTML} from './flora-mail-source.mjs';
const walk=p=>[p,...(p?.parts||[]).flatMap(walk)];
const header=(p,n)=>(p.headers||[]).find(h=>h.name.toLowerCase()===n)?.value||'';
export function mailDocumentCandidate(provider,subject,bodies,parts,refs){
 if(!['citylink','eurostar','gonordic'].includes(provider))return null;
 const html=bodies.find(b=>/<(?:html|table|body)\b/i.test(b));if(!html)return null;
 const allReferences=moreMessageReferences(provider,'',plainHTML(html));if(provider!=='citylink'&&(!allReferences.length||allReferences.some(r=>!refs.includes(r))))return null;
 const text=plainHTML(html),images=[...html.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
 if(provider==='citylink'){
  const bookings=[...new Set([...text.matchAll(/Booking Ref\s*:\s*(\d{8})\b/gi)].map(m=>m[1]))];
  if(bookings.length!==1||!refs.some(r=>text.includes(r))||!/Ticket No\s*:\s*ETS\d{8}/i.test(text))return null;
  const cids=images.filter(s=>s.startsWith('cid:')&&new RegExp('^cid:qr_code_'+bookings[0]+'_\\d+_\\d+\\.png$').test(s));
  if(!cids.length||cids.some(cid=>!parts.some(p=>header(p,'content-id')==='<'+cid.slice(4)+'>')))return null;
  return {html,provider,images:[...new Set(images.filter(s=>s.startsWith('cid:')))].map(src=>({src,part:parts.find(p=>header(p,'content-id')==='<'+src.slice(4)+'>'),required:cids.includes(src)})).filter(x=>x.part),title:'Citylink · originele ticketmail'};
 }
 if(provider==='eurostar'){
  const barcodes=images.filter(src=>eurostarBarcode(src,refs));if(!barcodes.length||!/here are (?:the|your) tickets|your Eurostar tickets/i.test(subject+' '+text))return null;
  return {html,provider,images:[...new Set(barcodes)].map(src=>({src,url:src,required:true})),title:'Eurostar · originele ticketmail'};
 }
 if(!/^Your booking is now confirmed[!.]?$/i.test(subject)||!/booking number\s*:/i.test(text)||!/provide your booking number|bring a valid photo ID/i.test(text))return null;
 return {html,provider,images:[],title:'Go Nordic · originele boekingsbevestiging'};
}
export async function loadMailDocument(item,{google,fetcher=fetch}){
 const get=await google.reader(),images=[],deadline=Date.now()+25000;if(item.images.length>30)throw Error('Te veel ticketafbeeldingen.');
 for(const image of item.images){if(Date.now()>deadline)throw Error('Ticketafbeeldingen ophalen duurt te lang.');let bytes;
  if(image.part){const body=image.part.body||{},data=body.data||(body.attachmentId?(await get(`messages/${item.mail}/attachments/${body.attachmentId}`)).data:'');if(data.length>3*1024*1024)throw Error('Ticketafbeelding te groot.');bytes=Buffer.from(data,'base64url');}
  else{const u=eurostarBarcode(image.url,item.references);if(!u)throw Error('Ongeldige ticketbarcodebron.');const r=await fetcher(u,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Object.assign(Error('De originele Eurostar-barcode kan niet worden opgehaald. Open de ticketpagina en upload de PDF.'),{code:'TICKET_REMOTE_BLOCKED'});const chunks=[];let n=0;for await(const b of r.body){n+=b.length;if(n>2*1024*1024)throw Error('Ticketbarcode te groot.');chunks.push(b);}bytes=Buffer.concat(chunks);}
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216;
  if(!png&&!jpeg){if(image.required)throw Error('De originele ticketbarcode ontbreekt of is onleesbaar.');continue;}
  images.push({src:image.src,data:bytes.toString('base64'),required:image.required});
 }
 return {provider:item.provider,title:item.title,html:item.html,images};
}
