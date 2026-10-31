import {mailDocumentCandidate} from './booklets-mail-document.mjs';
import {moreProviders,morePatterns,moreTodoReferences,moreMessageReferences,moreAttachment,moreAttachmentReferences,moreLinks,morePortal} from './booklets-more-sources.mjs';
import {extraProviders,extraPatterns,extraTodoReferences,extraMessageReferences,extraAttachment,extraAttachmentReferences,preferredExtraAttachments} from './booklets-extra-sources.mjs';
import {ferryEnturProviders,ferryEnturPatterns,ferryEnturTodoReferences,ferryEnturMessageReferences,ferryEnturAttachment,ferryEnturAttachmentReferences,ferryEnturDiagnostic,ferryCancelled} from './booklets-ferry-entur.mjs';
import {plainHTML,pdfText} from './flora-mail-source.mjs';

export const retailProviders={...moreProviders,...extraProviders,...ferryEnturProviders,trainline:{name:'Trainline',domain:'thetrainline.com'},raileurope:{name:'Rail Europe',domain:'raileurope.com'},sbb:{name:'SBB',domain:'sbb.ch'}};
const normal=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/[\s-]/g,'');
const patterns={...morePatterns,...extraPatterns,...ferryEnturPatterns,trainline:/^(?:[A-Z0-9]{6}|\d{12})$/,raileurope:/^(?:RE)?[A-Z0-9]{6}$/,sbb:/^\d{6,12}$/};
export function retailTodoReferences(todo,provider){
 if(moreProviders[provider])return moreTodoReferences(todo,provider);
 if(extraProviders[provider])return extraTodoReferences(todo,provider);
 if(ferryEnturProviders[provider])return ferryEnturTodoReferences(todo,provider);
 const title=(todo.title||'')+' '+(todo.description||'');
 if(!/trein|train|ticket|rail|eurostar|tgv|sncf|renfe|sbb|gotthard|gopex/i.test(title))return [];
 if(provider==='sbb'&&!/\b(?:SBB|GoPEx)\b|Gotthard Panorama/i.test(title))return [];
 const branded={trainline:'Trainline',raileurope:'Rail\\s*Europe',sbb:'SBB'}[provider];
 const raw=String(todo.supplierBookingNumber||'').replace(new RegExp('^'+branded+'\\s*[:#-]?\\s*','i'),'');
 return [...new Set(raw.split(/[,;|/]/).map(normal).filter(r=>patterns[provider].test(r)))];
}
export function retailMessageReferences(provider,subject,text,filenames=[]){
 if(moreProviders[provider])return moreMessageReferences(provider,subject,text,filenames);
 if(extraProviders[provider])return extraMessageReferences(provider,subject,text,filenames);
 if(ferryEnturProviders[provider])return ferryEnturMessageReferences(provider,subject,text,filenames);
 const source=subject+'\n'+text,refs=new Set(),add=r=>{r=normal(r);if(patterns[provider].test(r))refs.add(r);};
 const labels=provider==='trainline'?/\b(?:PNR[- ]?(?:referentie|reference)?|(?:booking|boekings)[- ]?(?:reference|referentie)|transacti(?:e|on)[- ]ID)\s*[:#]?\s*([A-Z0-9]{6,12})\b/gi:
 provider==='raileurope'?/\b(?:order reference|booking(?: reference)?|PNR(?: reference)?)\s*[:#]?\s*((?:RE[- ]?)?[A-Z0-9]{6})\b/gi:
 /\b(?:Bestell[- ]?(?:Nr\.?|nummer)|Referenz[- ]?Nr\.?|Ticket[- ]ID|order (?:no\.?|number)|Reservati(?:onsnummer|on number)|reservation)\s*[:#]?\s*(\d{6,12}(?:-\d{1,2})?)\b/gi;
 for(const m of source.matchAll(labels))add(m[1]);
 if(provider==='trainline')for(const name of filenames){const r=name.match(/^([A-Z0-9]{6})_.+_Ticket\d+\.pdf$/i);if(r)add(r[1]);}
 return [...refs];
}
export function retailAttachment(name,provider,subject='',from=''){
 if(moreProviders[provider])return moreAttachment(name,provider);
 if(extraProviders[provider])return extraAttachment(name,provider);
 if(ferryEnturProviders[provider])return ferryEnturAttachment(name,provider,subject);
 if(!/\.pdf$/i.test(name)||/invoice|rechnung|factuur|receipt|refund|order[_ -]?confirmation|news|newsletter|fahrplan/i.test(name))return false;
 if(provider==='trainline')return /^(?:[A-Z0-9]{6}_.+_Ticket\d+|(?:Adult|Child|Infant|Youth|Senior)_\d+_.+|(?:e[-_ ]?)?tickets?(?:[_. -].*)?)\.pdf$/i.test(name);
 if(provider==='raileurope')return /^(?:e[-_ ]?)?tickets?(?:[_. -].*)?\.pdf$/i.test(name);
 return /ticket|billett?|fahrkarte|reservierung|reservation|sitzplatz/i.test(name)||/shop-gopex@sbb\.ch/i.test(from)&&/Gotthard Panorama Express/i.test(subject)&&/^\d{10}\.pdf$/.test(name);
}
export function retailPortal(value,provider){
 if(moreProviders[provider])return morePortal(value,provider);
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return '';
  if(provider==='sbb'&&u.hostname==='shop.sbb.ch'&&/^\/customer\/(?:de|en|fr|it)\/alw\/order$/.test(u.pathname)&&u.searchParams.getAll('orderId').length===1&&[...u.searchParams.keys()].every(k=>k==='orderId')&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(u.searchParams.get('orderId')||''))return u.href;
 }catch{}return '';
}
export function retailSearchQuery(provider,reference){
 const term=normal(reference).replace(provider==='teldar'?/\/\d{1,2}$/:/$^/,'');if(!/^[A-Z0-9]{3,18}$/.test(term))throw Error('Ongeldige vervoerdersreferentie.');
 const variants=[term];if(provider==='raileurope'&&/^RE[A-Z0-9]{6}$/.test(term))variants.push('RE-'+term.slice(2));
 if(provider==='sbb'&&/^\d{7,8}$/.test(term))variants.push(term.slice(0,6)+'-'+term.slice(6));
 return `${retailProviders[provider].domains?'{'+retailProviders[provider].domains.map(d=>'from:'+d).join(' ')+'}':'from:('+retailProviders[provider].domain+')'} {${variants.map(v=>'"'+v+'"').join(' ')}} -in:spam -in:trash`;
}
const walk=p=>[p,...(p?.parts||[]).flatMap(walk)];
const header=(m,n)=>(m.payload?.headers||[]).find(h=>h.name.toLowerCase()===n)?.value||'';
const sender=(from,provider)=>{const domain=from.match(/(?:<|\b)[A-Z0-9._%+-]+@([A-Z0-9.-]+)>?\s*$/i)?.[1]?.toLowerCase(),expected=retailProviders[provider].domains||[retailProviders[provider].domain];return expected.some(d=>domain===d||domain?.endsWith('.'+d));};
export function createRetailMail({google,bookings,store,clock,readPDF=pdfText,referenceDates,bookingJourneyDates}){
 return {async search(payload){
  const provider=payload.provider,config=retailProviders[provider],term=normal(payload.query).replace(provider==='teldar'?/\/\d{1,2}$/:/$^/,'');
  if(!/^[A-Z0-9]{3,18}$/.test(term))throw Error('Vul een boekingsnummer of vervoerdersreferentie in.');
  if(!(await google.status()).connected)throw Error('Koppel de Gmail-mailbox eerst in FloRA.');
  const get=await google.reader(),deadline=clock()+90000,check=()=>{if(clock()>deadline)throw Error('Tickets zoeken duurt te lang. Zoek één referentie tegelijk.');};
  let booking=null;
  if(/^\d{3,8}[A-Z]?$/.test(term)){
   const number=term.replace(/[A-Z]$/,''),found=await bookings({trips:[number]}),unique=new Map();
   for(const b of found)if(String(b.index)===number){const id=b._id.replace(/^drafts\./,'');if(!unique.has(id)||b._id.startsWith('drafts.'))unique.set(id,b);}
   if(payload.bookingId){booking=unique.get(payload.bookingId);if(!booking)throw Error('De geselecteerde Sanity-boeking hoort niet bij dit nummer.');}
   else{if(unique.size>1)throw Error('Dit nummer komt meermaals voor. Koppel eerst de juiste Sanity-boeking.');booking=[...unique.values()][0]||null;}
  }else if(payload.bookingId)throw Error('Zoek de gekoppelde boeking op het boekingsnummer.');
  const refs=booking?[...new Set((booking.todos||[]).flatMap(t=>retailTodoReferences(t,provider)))]:[],wanted=booking?refs:[term],queries=[...new Set([term,...refs])],ids=new Set();
  if(queries.length>20)throw Error('Te veel referenties. Zoek één referentie tegelijk.');
  for(const ref of queries){check();const r=await get('messages',{q:retailSearchQuery(provider,ref),maxResults:'50'});if(r.nextPageToken)throw Error('Meer dan vijftig mails gevonden. Zoek één referentie tegelijk.');for(const m of r.messages||[])ids.add(m.id);}
  if(ids.size>100)throw Error('Te veel mails gevonden. Zoek één referentie tegelijk.');
  const messages=[];let pdfChecks=0,excludedInvoices=0;
  for(const id of ids){check();const m=await get('messages/'+id,{format:'full'}),from=header(m,'from'),subject=header(m,'subject');
   if(!sender(from,provider)||!config.allowReplies&&/^(?:\[external\]\s*)?(?:re|fw|fwd)\s*:/i.test(subject))continue;
   const parts=walk(m.payload),bodies=[];
   for(const part of parts){if(!/^text\/(?:html|plain)$/.test(part.mimeType||'')||part.filename)continue;const body=part.body||{},data=body.data||(body.attachmentId?(await get(`messages/${id}/attachments/${body.attachmentId}`)).data:'');if(data.length>700000)throw Error('Ticketmail te groot.');bodies.push(Buffer.from(data,'base64url').toString('utf8'));}
   const text=plainHTML(bodies.join('\n')),attachments=parts.filter(p=>p.mimeType==='application/pdf'||/\.pdf$/i.test(p.filename||''));if(attachments.length>30)throw Error('Meer dan dertig PDF-bijlagen.');
   const candidates=preferredExtraAttachments(attachments.filter(p=>retailAttachment(p.filename||'',provider,subject,from)),provider);excludedInvoices+=attachments.length-candidates.length;
   const foundRefs=new Set(retailMessageReferences(provider,subject,text,candidates.map(p=>p.filename))),pdfRefs=new Map();
   // Gmail can match text inside an attachment. Verify its labelled reference;
   // the search hit itself is never proof that a PDF belongs to this booking.
   let rejectedReceipt=false;const invalidPdfs=new Set(),verifyPDFsOnly=!wanted.some(r=>foundRefs.has(r));
   if(verifyPDFsOnly||provider==='entur')for(const p of candidates){invalidPdfs.add(p);check();if(++pdfChecks>15)throw Error('Te veel ticket-PDF’s om te controleren. Zoek één referentie tegelijk.');
    const body=p.body||{},data=body.data||(body.attachmentId?(await get(`messages/${id}/attachments/${body.attachmentId}`)).data:'');
    if(!data||data.length>14*1024*1024)continue;const bytes=Buffer.from(data,'base64url');if(bytes.length>10*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')continue;
    let pages;try{pages=await readPDF(bytes);}catch{continue;}if(provider==='entur'&&/not valid as (?:a )?ticket|electronic sales receipt|refund receipt|kvittering.*ikke.*billett/i.test(pages.join(' '))){rejectedReceipt=true;continue;}invalidPdfs.delete(p);const parsed=retailMessageReferences(provider,'',pages.join('\n'));pdfRefs.set(p,parsed);for(const r of parsed)foundRefs.add(r);
   }
   const matches=wanted.filter(r=>foundRefs.has(r));if(!matches.length)continue;
   const cancelled=ferryEnturProviders[provider]?ferryCancelled(provider,subject):/geannuleerd|annulering|cancel(?:led|ed|lation)|storno|storniert|refund|terugbetaling|anulaci[oó]n|cancelaci[oó]n/i.test(subject),tickets=[];
   for(const p of candidates){if(invalidPdfs.has(p))continue;let own=pdfRefs.get(p)||[];
    if(ferryEnturProviders[provider]){const fileRefs=ferryEnturAttachmentReferences(p.filename,provider);if(fileRefs.length)own=fileRefs;}
    if(moreProviders[provider]){const fileRefs=moreAttachmentReferences(p.filename,provider);if(fileRefs.length)own=fileRefs;}
    if(extraProviders[provider]){const fileRefs=extraAttachmentReferences(p.filename,provider);if(fileRefs.length)own=fileRefs;}
    if(provider==='trainline'){const pnrs=retailMessageReferences(provider,'','',[p.filename]);if(pnrs.length)own=pnrs;}
    if((verifyPDFsOnly||own.length)&&!own.some(r=>matches.includes(r)))continue;
    const reference=own.find(r=>matches.includes(r))||matches[0];tickets.push({id:store({kind:'attachment',provider,mail:id,reference,filename:p.filename,attachmentId:p.body?.attachmentId,data:p.body?.data}),title:p.filename,reference});
   }
   for(const link of moreLinks(bodies,provider))tickets.push({id:store({kind:'carrier-link',provider,mail:id,reference:matches[0],link}),title:config.name+' '+matches[0]+' · PDF',reference:matches[0]});
   const document=mailDocumentCandidate(provider,subject,bodies,parts,matches);if(document&&!tickets.length)tickets.push({id:store({kind:'mail-document',...document,mail:id,references:matches}),mailDocument:true,title:document.title,reference:matches[0]});
   const manualLinks=[...new Set(bodies.flatMap(b=>[...b.matchAll(/https:\/\/[^\s<>"']+/g)].map(x=>x[0].replaceAll('&amp;','&'))).map(u=>retailPortal(u,provider)).filter(Boolean))].map(url=>({url,label:config.name+'-ticketpagina openen'}));
   for(const url of moreLinks(bodies,provider))if(!manualLinks.some(l=>l.url===url))manualLinks.push({url,label:config.name+'-PDF downloaden'});
   const ambiguous=['ratehawk','teldar'].includes(provider)&&matches.some(ref=>tickets.filter(t=>t.reference===ref).length>1);
   messages.push({...(ambiguous?{automatic:false}:{}),diagnostic:ambiguous?'Meerdere '+config.name+'-vouchers voor dezelfde reservering gevonden. Kies de juiste pagina’s handmatig.':ferryEnturDiagnostic(provider,rejectedReceipt?'This receipt is not valid as a ticket.':text,attachments.map(p=>p.filename)),id,reference:matches[0],references:matches,subject,date:new Date(Number(m.internalDate)).toISOString(),cancelled,tickets:cancelled?[]:tickets,manualLinks,changed:/changed|gewijzigd|geändert|amended|cambios/i.test(subject)});
  }
  messages.sort((a,b)=>b.date.localeCompare(a.date));const meaningful=new Set(messages.filter(m=>m.tickets.length||m.manualLinks.length||m.cancelled||m.changed).flatMap(m=>m.references)),seen=new Set();
  for(const m of messages){const usable=m.tickets.length||m.manualLinks.length||m.cancelled||m.changed||m.references.some(r=>!meaningful.has(r));m.latest=!!usable&&m.references.every(r=>!seen.has(r));if(usable)for(const r of m.references)seen.add(r);m.selected=m.latest&&!m.cancelled&&m.tickets.length>0;}
  return {provider:config.name,providerKey:provider,query:term,booking:booking?String(booking.index):null,references:refs,referenceDates:booking?referenceDates(booking,refs,provider):[],journeyDates:booking?bookingJourneyDates(booking):[],travelDates:[],excludedInvoices,messages};
 }};
}
