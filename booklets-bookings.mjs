import {sanityConfig} from './flora-sanity.mjs';
import {createHash} from 'node:crypto';

const idPattern=/^[A-Za-z0-9_.-]{1,128}$/;
const cleanNumber=value=>{const n=String(value||'').trim().toUpperCase();if(!/^\d{3,8}[A-Z]?$/.test(n))throw Error('Vul een Treinrondreis-boekingsnummer in, bijvoorbeeld 6031A.');return n.replace(/[A-Z]$/,'');};
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('-'):'';
const projection='_id,_rev,index,firstName,lastName,address,postalCode,city,dateDeparture,dateReturn,status,notes,todos,trip->{title},docs';

function current(rows){const by=new Map();for(const row of rows||[]){const id=row._id.replace(/^drafts\./,'');if(!by.has(id)||row._id.startsWith('drafts.'))by.set(id,{...row,_id:id});}return [...by.values()];}
export function bookingSummary(b){return {id:b._id,number:String(b.index),name:[b.firstName,b.lastName].filter(Boolean).join(' '),departure:b.dateDeparture||'',returnDate:b.dateReturn||'',trip:b.trip?.title||'',values:{klantvoornaam:b.firstName||'',klantachternaam:b.lastName||'',vertrekdatum:date(b.dateDeparture),terugkomstdatum:date(b.dateReturn),reisnaam:b.trip?.title||'',boekingsnummer:String(b.index)}};}
export function documentKind(d){if(d._type!=='doc'||d.template!=='doc')return '';if(/^brief(?:ing)?\s*:/i.test(d.title||''))return 'letter';if(/voucher/i.test(d.title||''))return 'voucher';return '';}

export function variableValue(field,booking){
 const path=String(field||'').split(':')[0].split('.');
 // A tourBooking and an ordinary booking are distinct contexts in Sanity letters.
 if(path[0]==='booking')return '';
 if(path.shift()!=='tourBooking'||path.some(k=>!/^\w+$/.test(k)||['__proto__','constructor','prototype'].includes(k)))throw Error('Niet ondersteund klantveld in de Sanity-brief. Upload de brief als PDF.');
 let value=booking;for(const key of path)value=value?.[key];
 if(value==null||value===''){
  const reservation=String(field||'').match(/^tourBooking\.todos\.(\d+)\.supplierBookingNumber(?::.*)?$/);
  if(reservation){const todo=booking.todos?.[Number(reservation[1])];throw Error('Het reserveringsnummer ontbreekt bij '+(todo?.title?'“'+todo.title+'”':'onderdeel '+(Number(reservation[1])+1))+' van deze boeking. Controleer het reserveringsnummer en het gekoppelde invulveld van dit document in Sanity.');}
  throw Error('Een klantveld in het Sanity-document ontbreekt: '+field+'. Controleer de boekingsgegevens en het invulveld in Sanity.');
 }
 if(typeof value==='object')throw Error('Niet ondersteund samengesteld klantveld in de Sanity-brief.');
 return String(value);
}

export async function expandContent(content,booking,readReference,stack=[],budget={count:0,deadline:Date.now()+90000}){
 const out=[];for(const original of content||[]){
  if(Date.now()>budget.deadline)throw Error('De Sanity-brief ophalen duurt te lang. Probeer opnieuw.');
  if(++budget.count>2000)throw Error('De Sanity-brief bevat te veel onderdelen.');
  if(original._type==='reference'){
   const id=original._ref;if(!idPattern.test(id||'')||id.startsWith('drafts.')||stack.includes(id)||stack.length>=8)throw Error('Ongeldige of circulaire standaardtekst in de brief.');
   const doc=await readReference(id);if(!doc||doc._type!=='reusableText')throw Error('Een standaardtekst in de brief is niet meer gepubliceerd.');
   out.push(...await expandContent(doc.content,booking,readReference,[...stack,id],budget));continue;
  }
  const b=structuredClone(original);
  if(b._type==='table'){
   for(const row of b.rows||[]){if(!Array.isArray(row.cells)||row.cells.some(c=>typeof c!=='string'))throw Error('Niet ondersteunde tabel in de Sanity-brief. Upload de brief als PDF.');out.push({_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:row.cells.join(' — '),marks:[]}]});}continue;
  }
  if(b._type==='block'){
   const defs=new Map((b.markDefs||[]).filter(d=>d._type==='variable').map(d=>[d._key,d]));
   for(const span of b.children||[]){const variables=(span.marks||[]).filter(m=>defs.has(m));if(variables.length>1)throw Error('Een tekst bevat meerdere klantvelden. Controleer de brief in Sanity.');if(variables.length){span.text=variableValue(defs.get(variables[0]).field,booking);span.marks=(span.marks||[]).filter(m=>!defs.has(m));}}
   b.markDefs=(b.markDefs||[]).filter(d=>d._type!=='variable');
  }
  out.push(b);
 }return out;
}

export function createBookletsBookings({fetcher=fetch,configuration=sanityConfig}={}){
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
  async search(p){const number=cleanNumber(p.number);const bookings=await query(`*[_type=="tourBooking" && index==$number] | order(_id asc)[0...101]{_id,index,firstName,lastName,dateDeparture,dateReturn,status,_updatedAt,trip->{title}}`,{number:Number(number)});const unique=current(bookings);if(bookings.length>100||unique.length>50)throw Error('Te veel boekingen gevonden voor dit nummer.');return {items:unique.map(b=>{const item=bookingSummary(b);item.sameNumberBookings=unique.length;item.number=String(p.number).trim().toUpperCase();item.values.boekingsnummer=item.number;return item;})};},
  async documents(p){const b=await selected(p);return {booking:bookingSummary(b),items:(b.docs||[]).filter(d=>d&&documentKind(d)).map(d=>({id:d._id,title:d.title,kind:documentKind(d),updatedAt:d._updatedAt,status:d._status||'',approved:d.approved===true,requiresReview:documentKind(d)==='voucher'&&d.approved!==true}))};},
  async document(p){const b=await selected(p),doc=(b.docs||[]).find(d=>d?._id===p.documentId&&documentKind(d));if(!doc)throw Error('Dit document hoort niet bij de geselecteerde boeking.');if(documentKind(doc)==='voucher'&&doc.approved!==true)throw Error('Deze voucher is nog niet gecontroleerd in Sanity. Vink hem eerst aan in Sanity of kies een gecontroleerde PDF uit Google Drive.');
   const cache=new Map();const read=async id=>{if(cache.size>=60&&!cache.has(id))throw Error('De brief bevat te veel standaardteksten.');if(!cache.has(id))cache.set(id,await query('*[_type=="reusableText" && _id==$id][0]{_id,_type,_rev,content}',{id},'published'));return cache.get(id);};
   const content=await expandContent(doc.content,b,read);
   return {bookingId:b._id,documentId:doc._id,title:doc.title,kind:documentKind(doc),revision:doc._rev,approved:doc.approved===true,content,digest:createHash('sha256').update(JSON.stringify([doc.title,content])).digest('hex'),loadedAt:new Date().toISOString()};
  }
 };
}
export const bookletsBookings=createBookletsBookings();
