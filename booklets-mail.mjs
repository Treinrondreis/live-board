import {randomBytes} from 'node:crypto';
import {floraGoogle} from './flora-google.mjs';
import {fetchBookings} from './flora-sanity.mjs';
import {readFlora} from './flora-store.mjs';
import {safeTicketURL,decodeEntities,plainHTML} from './flora-mail-source.mjs';
import {nsOption} from './flora-options.mjs';
import {createCarrierMail,providerKey,safeCarrierPDF,referenceDates,referenceContinuationDates,isoDate,carrierReferences,bookingJourneyDates,gatePassOmissionReferences} from './booklets-carrier-mail.mjs';

const senders=['no-reply@confirmation.nsinternational.nl','ns@treinrondreis.nl'];
export const nsTicketSender=from=>/^(?:[^<>]*<)?(?:no-reply@confirmation\.nsinternational\.nl|ns@treinrondreis\.nl)>?$/i.test(String(from||'').trim());
const header=(m,n)=>(m.payload?.headers||[]).find(h=>h.name.toLowerCase()===n)?.value||'';
const walk=p=>[p,...(p?.parts||[]).flatMap(walk)];
export function bookingReferences(booking){
 const refs=new Set(carrierReferences(booking,'ns'));
 for(const m of String(booking.notes||'').toUpperCase().matchAll(/\b(?:DNR|NS(?:\s+INTERNATIONAL)?|BOEKINGSCODE)\s*[:=\-]?\s*([A-Z0-9]{6,8})\b/g))if(/[A-Z]/.test(m[1]))refs.add(m[1]);
 return [...refs];
}
export function createBookletsMail({google=floraGoogle,bookings=fetchBookings,state=readFlora,fetcher=fetch,clock=()=>Date.now()}={}){
 const tickets=new Map();let busy=false;
 const clean=()=>{for(const [key,item] of tickets)if(item.expires<clock())tickets.delete(key);};
 const store=item=>{clean();if(tickets.size>=500)throw Error('Te veel open ticketimports. Probeer over een halfuur opnieuw.');const id=randomBytes(24).toString('hex');tickets.set(id,{...item,expires:clock()+1800000});return id;};
 const carrier=createCarrierMail({google,bookings,store,clock});
 return {
  async search(payload){
   if(providerKey(payload.provider||'ns')!=='ns')return carrier.search(payload);
   const term=String(payload.query||'').trim().toUpperCase();
   if(!/^[A-Z0-9]{3,16}$/.test(term))throw Error('Vul een boekingsnummer of NS-referentie/DNR in, zonder spaties.');
   const deadline=clock()+90000;const checkTime=()=>{if(clock()>deadline)throw Error('Mails zoeken duurt te lang. Probeer één DNR tegelijk.');};
   const status=await google.status();if(!status.connected)throw Error('Koppel de Gmail-mailbox eerst in FloRA.');
   const get=await google.reader();const queries=new Set([term]);let booking=null;
   if(/^\d{3,8}[A-Z]?$/.test(term)){const number=term.replace(/[A-Z]$/,'');const found=await bookings({trips:[number]});const matches=found.filter(b=>String(b.index)===number);const byId=new Map();for(const b of matches){const id=b._id.replace(/^drafts\./,'');if(!byId.has(id)||b._id.startsWith('drafts.'))byId.set(id,b);}const unique=[...byId.values()];if(payload.bookingId){booking=unique.find(b=>b._id.replace(/^drafts\./,'')===payload.bookingId)||null;if(!booking)throw Error('De geselecteerde Sanity-boeking hoort niet bij dit nummer.');}else{if(unique.length>1)throw Error('Dit boekingsnummer komt meermaals voor. Koppel eerst de juiste Sanity-boeking.');booking=unique[0]||null;}if(booking)for(const ref of bookingReferences(booking))queries.add(ref);queries.add(number);}
   else {const cached=await state();const matches=(cached.state?.bookings||[]).filter(b=>bookingReferences(b).includes(term));if(matches.length===1)booking=matches[0];}
   if(queries.size>20)throw Error('Deze boeking heeft te veel referenties. Zoek op één NS-referentie tegelijk.');
   const ids=new Set();
   for(const q of queries){checkTime();const result=await get('messages',{q:`{${senders.map(s=>'from:'+s).join(' ')}} "${q}" -in:spam -in:trash`,maxResults:'50'});if(result.nextPageToken)throw Error('Meer dan vijftig mails gevonden voor een referentie. Zoek op een specifiekere NS-referentie.');for(const m of result.messages||[])ids.add(m.id);}
   if(ids.size>100)throw Error('Te veel mails gevonden. Zoek op een NS-referentie.');
   const messages=[];
   for(const id of ids){checkTime();const m=await get('messages/'+id,{format:'full'});const from=header(m,'from'),subject=header(m,'subject');if(!nsTicketSender(from))continue;if(nsOption({from,subject}))continue;
    let ref=subject.match(/boekingscode\s*:\s*([A-Z0-9]+)/i)?.[1]?.toUpperCase()||'';
    const own=subject.match(/naam\s*:\s*([^,]+)/i)?.[1]?.trim()||'';const links=[];
    for(const part of walk(m.payload)){if(!/^text\//.test(part.mimeType||''))continue;const data=part.body?.data||(part.body?.attachmentId?(await get(`messages/${id}/attachments/${part.body.attachmentId}`)).data:'');const body=Buffer.from(data||'','base64url').toString('utf8');if(!ref)ref=plainHTML(body).match(/\b(?:DNR|boekingscode)\s*:\s*([A-Z0-9]{6,8})\b/i)?.[1]?.toUpperCase()||'';
     for(const match of body.matchAll(/href\s*=\s*["']([^"']+)/gi)){const link=decodeEntities(match[1]);if(safeTicketURL(link)&&!links.includes(link))links.push(link);}
     if(part.mimeType==='text/plain')for(const match of body.matchAll(/https:\/\/www\.bene-system\.com\/hp\/pdfservice\?[^\s<>"']+/g)){const link=decodeEntities(match[0]);if(safeTicketURL(link)&&!links.includes(link))links.push(link);}
    }
    if(links.length>30)throw Error('Een mail heeft meer dan dertig ticketknoppen. Controleer deze mail handmatig.');
    messages.push({id,reference:ref,bookingLabel:own,subject,date:new Date(Number(m.internalDate)).toISOString(),cancelled:/geannuleerd|annulering|cancelled|cancellation/i.test(subject),tickets:links.map((link,n)=>({id:store({link,mail:id,reference:ref}),title:`NS ${ref||term} · PDF ${n+1}`}))});
   }
   messages.sort((a,b)=>b.date.localeCompare(a.date));const latest=new Set();
   for(const m of messages){const group=m.reference||m.id;m.latest=!latest.has(group);latest.add(group);m.selected=m.latest&&!!m.reference&&!m.cancelled&&m.tickets.length>0;}
   return {provider:'NS International',providerKey:'ns',query:term,booking:booking?String(booking.index):null,references:booking?bookingReferences(booking):[],gatePassOmissionReferences:booking?gatePassOmissionReferences(booking):[],referenceDates:booking?referenceDates(booking,bookingReferences(booking)):[],referenceContinuationDates:booking?referenceContinuationDates(booking,bookingReferences(booking)):[],journeyDates:booking?bookingJourneyDates(booking):[],travelDates:booking?[...new Set((booking.todos||[]).map(t=>isoDate(t.startDate)).filter(Boolean))]:[],messages};
  },
  async download(payload){
   clean();const item=tickets.get(payload.ticket);if(!item)throw Error('Deze ticketselectie is verlopen. Zoek de mails opnieuw.');if(busy){const e=Error('Er wordt al een ticket opgehaald. Probeer zo opnieuw.');e.status=429;throw e;}busy=true;
   try {
    if(item.kind==='attachment'){const get=await google.reader();const body=item.data?{data:item.data}:item.attachmentId?await get(`messages/${item.mail}/attachments/${item.attachmentId}`):null;if(!body?.data||body.data.length>14*1024*1024)throw Error('Ticketbijlage ontbreekt of is groter dan 10 MB.');const bytes=Buffer.from(body.data,'base64url');if(bytes.length>10*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Deze ticketbijlage is geen geldige PDF van maximaal 10 MB.');return bytes;}
    const safe=link=>item.kind==='carrier-link'?safeCarrierPDF(link,item.provider):safeTicketURL(link);let u=safe(item.link);if(!u)throw Error('Niet ondersteunde ticketverwijzing.');let response;const signal=AbortSignal.timeout(25000);
    for(let hop=0;hop<=3;hop++){response=await fetcher(u,{redirect:'manual',signal,headers:{Accept:'application/pdf'}});if(![301,302,303,307,308].includes(response.status))break;const location=response.headers.get('location');await response.body?.cancel();u=location&&safe(new URL(location,u).href);if(!u||hop===3)throw Error('Niet ondersteunde ticketverwijzing.');}
    if(!response.ok)throw Error('Ticket niet beschikbaar (HTTP '+response.status+').');const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>10*1024*1024){await response.body.cancel().catch(()=>{});throw Error('Ticket-PDF is groter dan 10 MB.');}chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);if(bytes.subarray(0,5).toString()!=='%PDF-'){const e=Error('Deze ticketknop levert geen PDF. Mogelijk is het ticket geannuleerd of verlopen.');e.code='TICKET_NOT_PDF';throw e;}return bytes;
   }finally{busy=false;}
  }
 };
}
export const bookletsMail=createBookletsMail();
