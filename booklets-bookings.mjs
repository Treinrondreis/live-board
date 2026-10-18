import {sanityConfig} from './flora-sanity.mjs';
import {createHash} from 'node:crypto';
import {isoDate,bookingJourneyDates} from './booklets-carrier-mail.mjs';

const idPattern=/^[A-Za-z0-9_.-]{1,128}$/;
const cleanNumber=value=>{const n=String(value||'').trim().toUpperCase();if(!/^\d{3,8}[A-Z]?$/.test(n))throw Error('Vul een Treinrondreis-boekingsnummer in, bijvoorbeeld 6031A.');return n.replace(/[A-Z]$/,'');};
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):'';
const projection='_id,_rev,index,firstName,lastName,address,postalCode,city,dateDeparture,dateReturn,status,notes,todos,trip->{title},docs,documents[]{title,asset->{_id,mimeType,size,originalFilename,url}}';

export function voucherAttachments(b){
 const stays=(b.todos||[]).filter(t=>isoDate(t.startDate)&&isoDate(t.endDate)&&t.endDate>t.startDate&&!/trein|train|nightjet|railjet|ticket|\b(?:EUN|RIT|RITAD|RITAM|CORA\d*|NS|DB|OBB|ÖBB)\b/i.test(t.title||''));
 const compact=d=>d.slice(8,10)+d.slice(5,7);
 return (b.documents||[]).filter(d=>d.asset?.mimeType==='application/pdf'&&/^file-[a-f0-9]{40}-pdf$/.test(d.asset._id||''))
 .filter(d=>!/factuur|invoice|rechnung|ticket|fahrkarte|reisschema|tijdlijn|itinerary/i.test((d.title||'')+' '+(d.asset.originalFilename||'')))
 .map(d=>{const title=d.title||d.asset.originalFilename||'PDF-bijlage',name=title+' '+(d.asset.originalFilename||'');const matching=stays.filter(t=>new RegExp(compact(t.startDate)+'[-_ ]+'+compact(t.endDate)).test(name)),dates=[...new Set(matching.map(t=>isoDate(t.startDate)))];return {id:d.asset._id,title,kind:'voucher',attachment:true,requiresReview:false,recommended:/voucher|hotel|accommodation/i.test(name)||matching.length>0,...(dates.length===1?{travelDate:dates[0]}:{})};});
}

function current(rows){const by=new Map();for(const row of rows||[]){const id=row._id.replace(/^drafts\./,'');if(!by.has(id)||row._id.startsWith('drafts.'))by.set(id,{...row,_id:id});}return [...by.values()];}
export function bookingSummary(b){return {id:b._id,number:String(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:b.dateDeparture||'',returnDate:b.dateReturn||'',journeyDates:bookingJourneyDates(b),trip:b.trip?.title||'',values:{klantvoornaam:b.firstName||'',klantachternaam:b.lastName||'',vertrekdatum:date(b.dateDeparture),terugkomstdatum:date(b.dateReturn),reisnaam:b.trip?.title||'',boekingsnummer:String(b.index)}};}
export function documentKind(d){if(d._type!=='doc'||d.template!=='doc')return '';if(/^brief(?:ing)?\s*:/i.test(d.title||''))return 'letter';if(/voucher/i.test(d.title||''))return 'voucher';return '';}
export function voucherDate(content){const values=new Set();const add=text=>{const m=String(text).match(/\b(?:20\d{2}-\d{2}-\d{2}|\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2})\b/);if(m&&isoDate(m[0]))values.add(isoDate(m[0]));};for(const block of content||[]){if(block._type==='table')for(const row of block.rows||[])if(/^(?:check[ -]?in|incheck(?:datum|en)?|arrival date)\s*:?$/i.test(row.cells?.[0]?.trim()||''))add(row.cells.slice(1).join(' '));if(block._type==='block'){const text=(block.children||[]).map(s=>s.text||'').join('');const m=text.match(/(?:check[ -]?in|incheck(?:datum|en)?|arrival date)\s*:?\s*([^\n]{0,80})/i);if(m)add(m[1]);}}return values.size===1?[...values][0]:'';}

export function variableValue(field,booking,options={}){
 const path=String(field||'').split(':')[0].split('.');
 // A tourBooking and an ordinary booking are distinct contexts in Sanity letters.
 if(path[0]==='booking')return '';
 if(path.shift()!=='tourBooking'||path.some(k=>!/^\w+$/.test(k)||['__proto__','constructor','prototype'].includes(k)))throw Error('Niet ondersteund klantveld in de Sanity-brief. Upload de brief als PDF.');
 let value=booking;for(const key of path)value=value?.[key];
 if(value==null||value===''){
  const reservation=String(field||'').match(/^tourBooking\.todos\.(\d+)\.supplierBookingNumber(?::.*)?$/);
  if(reservation){if(options.onMissingReservation){options.onMissingReservation();return '';}const todo=booking.todos?.[Number(reservation[1])];throw Error('Het reserveringsnummer ontbreekt bij '+(todo?.title?'“'+todo.title+'”':'onderdeel '+(Number(reservation[1])+1))+' van deze boeking. Controleer het reserveringsnummer en het gekoppelde invulveld van dit document in Sanity.');}
  throw Error('Een klantveld in het Sanity-document ontbreekt: '+field+'. Controleer de boekingsgegevens en het invulveld in Sanity.');
 }
 if(typeof value==='object')throw Error('Niet ondersteund samengesteld klantveld in de Sanity-brief.');
 return String(value);
}

export async function expandContent(content,booking,readReference,stack=[],budget={count:0,deadline:Date.now()+90000},options={}){
 const out=[];for(const original of content||[]){
  if(Date.now()>budget.deadline)throw Error('De Sanity-brief ophalen duurt te lang. Probeer opnieuw.');
  if(++budget.count>2000)throw Error('De Sanity-brief bevat te veel onderdelen.');
  if(original._type==='reference'){
   const id=original._ref;if(!idPattern.test(id||'')||id.startsWith('drafts.')||stack.includes(id)||stack.length>=8)throw Error('Ongeldige of circulaire standaardtekst in de brief.');
   const doc=await readReference(id);if(!doc||doc._type!=='reusableText')throw Error('Een standaardtekst in de brief is niet meer gepubliceerd.');
   out.push(...await expandContent(doc.content,booking,readReference,[...stack,id],budget,options));continue;
  }
  const b=structuredClone(original);
  if(b._type==='table'){
   if(options.preserveTables){if(!Array.isArray(b.rows)||b.rows.length>200||b.rows.some(row=>!Array.isArray(row.cells)||row.cells.length<1||row.cells.length>8||row.cells.some(c=>typeof c!=='string')))throw Error('Niet ondersteunde tabel in het Sanity-document.');out.push(b);continue;}
   for(const row of b.rows||[]){if(!Array.isArray(row.cells)||row.cells.some(c=>typeof c!=='string'))throw Error('Niet ondersteunde tabel in de Sanity-brief. Upload de brief als PDF.');out.push({_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:row.cells.join(' — '),marks:[]}]});}continue;
  }
  if(b._type==='block'){
   const defs=new Map((b.markDefs||[]).filter(d=>d._type==='variable').map(d=>[d._key,d]));
   for(const span of b.children||[]){const variables=(span.marks||[]).filter(m=>defs.has(m));if(variables.length>1)throw Error('Een tekst bevat meerdere klantvelden. Controleer de brief in Sanity.');if(variables.length){span.text=variableValue(defs.get(variables[0]).field,booking,options);span.marks=(span.marks||[]).filter(m=>!defs.has(m));}}
   b.markDefs=(b.markDefs||[]).filter(d=>d._type!=='variable');
  }
  out.push(b);
 }return out;
}

export function createBookletsBookings({fetcher=fetch,configuration=sanityConfig}={}){
 async function originalPdf(id){
  const config=configuration();
  // Fixed official renderer and a verified linked document ID. Never redirect credentials.
  const url=`https://www.treinrondreis.nl/api/v2/doc/${encodeURIComponent(id)}.pdf?background=true`;
  const response=await fetcher(url,{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(45000)});
  if([401,403].includes(response.status))throw Error('De originele PDF met huisstijl vereist toegang tot de Treinrondreis-documentexport. Upload de originele PDF zolang deze koppeling geen toegang heeft.');
  if(!response.ok)throw Error('De originele Sanity-PDF kon niet worden opgehaald. Probeer opnieuw of upload de originele PDF.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>30*1024*1024)throw Error('De oorspronkelijke PDF is groter dan 30 MB.');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('De documentexport gaf geen geldige PDF terug. Upload de originele PDF.');
  return bytes.toString('base64');
 }
 async function query(groq,params={},perspective='raw'){
  const c=configuration();if(!c.token)throw Error('De Sanity Viewer-koppeling is nog niet ingesteld in Seinhuis.');
  if(!/^[a-z0-9]+$/.test(c.project)||!/^[-a-z0-9]+$/.test(c.dataset))throw Error('Ongeldige Sanity-instellingen.');
  const u=new URL(`https://${c.project}.api.sanity.io/v2026-10-03/data/query/${c.dataset}`);u.searchParams.set('query',groq);u.searchParams.set('perspective',perspective);for(const [k,v]of Object.entries(params))u.searchParams.set('$'+k,JSON.stringify(v));
  const r=await fetcher(u,{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Sanity-boeking kon niet worden gelezen. Controleer de Viewer-koppeling.');
  const raw=await r.text();if(raw.length>4*1024*1024)throw Error('Sanity-document te groot.');return JSON.parse(raw).result;
 }
 async function selected(payload){
  if(!idPattern.test(payload.bookingId||'')||payload.bookingId.startsWith('drafts.'))throw Error('Selecteer eerst een Sanity-boeking.');
  const rows=await query(`*[_type=="tourBooking" && _id in $ids]{${projection}}`,{ids:[payload.bookingId,'drafts.'+payload.bookingId]}),b=current(rows)[0];
  if(!b)throw Error('Deze Sanity-boeking bestaat niet meer.');if(payload.number&&String(b.index)!==cleanNumber(payload.number))throw Error('Het boekingsnummer hoort niet bij de geselecteerde boeking.');
  const refs=(b.docs||[]).map(d=>d._ref).filter(id=>idPattern.test(id||'')),docs=refs.length?current(await query('*[_type=="doc" && _id in $ids]{_id,_rev,_updatedAt,_status,_type,title,template,approved,content}',{ids:refs.flatMap(id=>[id,'drafts.'+id])})):[];
  const by=new Map(docs.map(d=>[d._id,d]));b.docs=refs.map(id=>by.get(id)).filter(Boolean);return b;
 }
 return {
  async search(p){
   const term=String(p.number||'').trim(),numeric=/^\d+[a-z]?$/i.test(term),fields='_id,index,firstName,lastName,dateDeparture,dateReturn,status,_updatedAt,trip->{title}';
   let rows;
   if(numeric)rows=await query(`*[_type=="tourBooking" && index==$number] | order(_id asc)[0...101]{${fields}}`,{number:Number(cleanNumber(term))});
   else{
    if(term.length<3||term.length>80||!/^[\p{L}\p{N} .’'\-]+$/u.test(term))throw Error('Gebruik minimaal drie letters van de naam, een postcode of een boekingsnummer.');
    const needle='*'+term.toLowerCase()+'*',compact=term.replace(/\s/g,'').toLowerCase(),postalSpaced=/^\d{4}[a-z]{2}$/.test(compact)?compact.slice(0,4)+' '+compact.slice(4):term.toLowerCase();
    rows=await query(`*[_type=="tourBooking" && (lower(firstName) match $needle || lower(lastName) match $needle || lower(firstName+" "+lastName) match $needle || lower(postalCode) match $postal || lower(postalCode) match $postalSpaced)] | order(dateDeparture desc)[0...101]{${fields}}`,{needle,postal:compact,postalSpaced});
   }
   const unique=current(rows);if(rows.length>100||unique.length>50)throw Error('Te veel boekingen gevonden. Gebruik een specifiekere zoekterm.');
   let counts;
   if(!numeric&&unique.length){const numbers=[...new Set(unique.map(b=>b.index))],all=await query('*[_type=="tourBooking" && index in $numbers][0...501]{_id,index}',{numbers});counts=all.length<=500?current(all):[];}
   return {items:unique.map(b=>{const item=bookingSummary(b);item.sameNumberBookings=numeric?unique.length:counts.filter(x=>x.index===b.index).length;if(numeric){item.number=term.toUpperCase();item.values.boekingsnummer=item.number;}return item;})};
  },
  async documents(p){const b=await selected(p);return {booking:{...bookingSummary(b),todos:(b.todos||[]).slice(0,500).map(t=>({title:String(t.title||'').slice(0,2000),description:String(t.description||'').slice(0,4000),startDate:isoDate(t.startDate),endDate:isoDate(t.endDate)}))},attachments:voucherAttachments(b),items:(b.docs||[]).filter(d=>d&&documentKind(d)).map(d=>({id:d._id,title:d.title,kind:documentKind(d),updatedAt:d._updatedAt,status:d._status||'',approved:d.approved===true,requiresReview:documentKind(d)==='voucher'&&d.approved!==true}))};},
  async attachment(p){
   const b=await selected(p),item=voucherAttachments(b).find(d=>d.id===p.documentId);if(!item)throw Error('Deze PDF-bijlage hoort niet bij de geselecteerde boeking of is geen mogelijke hotelvoucher.');
   const asset=b.documents.find(d=>d.asset?._id===item.id).asset,c=configuration(),u=new URL(asset.url);
   const expected='/files/'+c.project+'/'+c.dataset+'/'+item.id.slice(5,-4)+'.pdf';
   if(u.protocol!=='https:'||u.hostname!=='cdn.sanity.io'||u.port||u.username||u.password||u.search||u.hash||u.pathname!==expected)throw Error('De Sanity-bijlage heeft geen geldige bestandslocatie.');
   if(!(asset.size>0&&asset.size<=30*1024*1024))throw Error('De PDF-bijlage mag maximaal 30 MB zijn.');
   const meta={bookingId:b._id,documentId:item.id,kind:'voucher',title:item.title,attachment:true,approved:false,content:[],...(item.travelDate?{travelDate:item.travelDate}:{}),revision:item.id,digest:createHash('sha256').update(item.id).digest('hex'),loadedAt:new Date().toISOString(),warnings:[]};
   if(p.metadataOnly===true)return meta;
   const response=await fetcher(u,{method:'GET',headers:{Authorization:'Bearer '+c.token},redirect:'error',signal:AbortSignal.timeout(25000)});
   if(!response.ok)throw Error('De originele hotelbijlage kon niet worden gelezen. Controleer de Sanity-leestoegang of upload de PDF.');
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>30*1024*1024)throw Error('De hotelbijlage is te groot.');chunks.push(chunk);}
   const raw=Buffer.concat(chunks);if(raw.length!==Number(asset.size)||!raw.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error('De hotelbijlage is geen volledige PDF.');
   return {...meta,originalPdf:raw.toString('base64')};
  },
  async document(p){const b=await selected(p),doc=(b.docs||[]).find(d=>d?._id===p.documentId&&documentKind(d));if(!doc)throw Error('Dit document hoort niet bij de geselecteerde boeking.');if(documentKind(doc)==='voucher'&&doc.approved!==true)throw Error('Deze voucher is nog niet gecontroleerd in Sanity. Vink hem eerst aan in Sanity of kies een gecontroleerde PDF uit Google Drive.');
   const cache=new Map();const read=async id=>{if(cache.size>=60&&!cache.has(id))throw Error('De brief bevat te veel standaardteksten.');if(!cache.has(id))cache.set(id,await query('*[_type=="reusableText" && _id==$id][0]{_id,_type,_rev,content}',{id},'published'));return cache.get(id);};
   const warnings=[],options=documentKind(doc)==='voucher'?{preserveTables:true,onMissingReservation:()=>warnings.push(doc.title+': het reserveringsnummer kon niet worden ingevuld en is leeg gelaten. De voucher is wel gecontroleerd in Sanity.')}:{};
   const content=await expandContent(doc.content,b,read,[],undefined,options);
   return {bookingId:b._id,documentId:doc._id,title:doc.title,kind:documentKind(doc),revision:doc._rev,approved:doc.approved===true,content,...(documentKind(doc)==='voucher'?{travelDate:voucherDate(content)}:{}),warnings:[...new Set(warnings)],digest:createHash('sha256').update(JSON.stringify([doc.title,content])).digest('hex'),loadedAt:new Date().toISOString(),...(p.originalPdf===true?{originalPdf:await originalPdf(doc._id)}:{})};
  }
 };
}
export const bookletsBookings=createBookletsBookings();
