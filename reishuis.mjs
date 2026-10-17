import {createRinkelMedia} from './reishuis-rinkel-media.mjs';
import {rinkelIncoming} from './reishuis-rinkel.mjs';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {fetchReishuisBookings,selectRows,defaultRows,statuses} from './reishuis-data.mjs';
import {readReishuis,writeReishuis,readBookingSnapshot,writeBookingSnapshot,readDossierSnapshot,writeDossierSnapshot} from './reishuis-store.mjs';
import {fetchReishuisDossier,createDossierCache,mergeDossier,changeDossier} from './reishuis-dossier.mjs';
import {createBookingsCache} from './reishuis-cache.mjs';
import {paymentSummary} from './reishuis-payments.mjs';
import {dayInAmsterdam} from './reishuis-view.mjs';

const prefix='/seinhuis/reishuis',csrfSecret=process.env.ADMIN_ENCRYPTION_KEY||process.env.BOARD_ADMIN_PASSWORD||randomUUID();
const sessionCookie=req=>String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('tr_google_session='))||'';
const csrf=req=>createHmac('sha256',csrfSecret).update('reishuis-csrf-v1\0'+sessionCookie(req)).digest('hex');
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function invalid(){const e=Error('Invalid input');e.status=400;throw e;}
function text(value,max){if(typeof value!=='string'||value.length>max||value.includes('\u0000'))invalid();return value.trim();}
function key(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_.]{1,160}$/.test(value)||['__proto__','constructor','prototype'].includes(value))invalid();return value;}
export function applyChange(state,input,bookings,actor){
 const customer=id=>state.customers.find(c=>c.id===id)||invalid();
 if(input.action==='customer'){
  const name=text(input.name,160);if(!name)invalid();
  const duplicate=state.customers.some(c=>c.name.toLocaleLowerCase('nl-NL')===name.toLocaleLowerCase('nl-NL'));
  if(duplicate&&input.confirmDuplicate!==true){const e=Error('Duplicate name');e.status=409;throw e;}
  state.customers.push({id:randomUUID(),name});
 }else if(input.action==='link'){
  const booking=key(input.booking),id=key(input.customer);customer(id);
  if(!bookings.some(b=>b.id===booking))invalid();
  if(state.links[booking]&&state.links[booking]!==id){const e=Error('Already linked');e.status=409;throw e;}
  state.links[booking]=id;
 }else if(input.action==='unlink'){
  const booking=key(input.booking);if(input.confirm!==true||!state.links[booking])invalid();delete state.links[booking];
 }else if(input.action==='merge'){
  const from=key(input.from),to=key(input.to);customer(from);customer(to);
  if(from===to||input.confirm!==true||input.confirmName!==customer(to).name)invalid();
  for(const [booking,id] of Object.entries(state.links))if(id===from)state.links[booking]=to;
  // Preserve all notes and an auditable merge; never alter Sanity identities.
  state.notes['customer:'+to]=[state.notes['customer:'+to],state.notes['customer:'+from]].filter(Boolean).join('\n\n');
  delete state.notes['customer:'+from];state.customers=state.customers.filter(c=>c.id!==from);
 }else if(input.action==='note'){
  const id=key(input.id);if(input.kind==='customer')customer(id);else if(input.kind!=='booking'||!bookings.some(b=>b.id===id))invalid();
  state.notes[input.kind+':'+id]=text(input.note,10000);
 }else if(input.action==='dossier'){
  if(!bookings.some(b=>b.id===input.booking)||!input.source)invalid();
  changeDossier(state,input,input.source);
 }else if(input.action==='rows'){
  if(!Array.isArray(input.rows)||input.rows.length!==5||input.rows.some(r=>!r||typeof r.status!=='string'||r.status.length>160||(!statuses.includes(r.status)&&!bookings.some(b=>b.status===r.status))||!['created','departure'].includes(r.sort)))invalid();
  state.preferences[actor]=input.rows.map(({status,sort})=>({status,sort}));
 }else invalid();
 state.history.push({at:new Date().toISOString(),actor,action:input.action,...(input.action==='merge'?{from:input.from,to:input.to}:{})});state.history=state.history.slice(-500);
 return state;
}
export function createReishuisHandler({authenticate=async req=>(await import('./admin-security.mjs')).adminAuthenticated(req,'reishuis'),actor=async req=>(await import('./admin-security.mjs')).authenticatedActor(req),read=readReishuis,write=writeReishuis,readSnapshot=readBookingSnapshot,writeSnapshot=writeBookingSnapshot,fetchBookings=fetchReishuisBookings,readDossier=readDossierSnapshot,writeDossier=writeDossierSnapshot,fetchDossier=fetchReishuisDossier,rinkel=rinkelIncoming,media=createRinkelMedia(),fetcher=fetch,origin=process.env.SEINHUIS_PUBLIC_ORIGIN||'https://treinbord.up.railway.app',clock=Date.now}={}){
 const bookingCache=createBookingsCache({readSnapshot,writeSnapshot,fetchBookings,clock});
 const bookings=async()=>(await bookingCache.get()).bookings;
 const dossiers=createDossierCache({readSnapshot:readDossier,writeSnapshot:writeDossier,fetchDossier,clock});
 const photos=new Map(),photoPending=new Map();let photoBytes=0;
 async function photo(url){
  const saved=photos.get(url);if(saved&&saved.until>clock())return saved;
  if(saved){photos.delete(url);photoBytes-=saved.bytes.length;}
  if(photoPending.has(url))return photoPending.get(url);
  const task=(async()=>{
   const r=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)}),type=r.headers.get('content-type')?.split(';')[0];
   if(!r.ok||!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Photo unavailable');
   const parts=[];let size=0;for await(const part of r.body){size+=part.length;if(size>5*1024*1024)throw Error('Photo too large');parts.push(part);}
   const result={type,bytes:Buffer.concat(parts),until:clock()+86400000};
   while(photos.size&&(photoBytes+size>24*1024*1024||photos.size>=64)){const k=photos.keys().next().value;photoBytes-=photos.get(k).bytes.length;photos.delete(k);}
   photos.set(url,result);photoBytes+=size;return result;
  })().finally(()=>photoPending.delete(url));photoPending.set(url,task);return task;
 }
 return async(req,res,url)=>{
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  for(const [k,v] of Object.entries({'Cache-Control':'private, no-store','Vary':'Cookie','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; media-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"}))res.setHeader(k,v);
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));return true;};
  try{
   if(!await authenticate(req))return reply(403,{error:'Toegang vereist de Reishuis-rol. Meld je aan via Seinhuis.'});
   if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')return reply(403,{error:'Open Reishuis vanuit Seinhuis.'});
   if(req.headers.origin&&req.headers.origin!==origin)return reply(403,{error:'Ongeldige herkomst.'});
   const path=url.pathname.slice(prefix.length);
   if(req.method==='GET'){
    if(path==='/api/access')return reply(200,{ok:true});
    if(path==='/api/rinkel'){
     if(!rinkel.configured)return reply(200,{enabled:false});const [list,record]=await Promise.all([bookings(),read()]),result=await rinkel.poll({cursor:url.searchParams.get('cursor'),bookings:list,state:record.state});let changed=false;
     for(const event of result.events||[])if(event.matches.length===1&&!record.state.rinkelCalls?.[event.id]){rinkel.linkCall(record.state,{call:event.id,booking:event.matches[0].id,remember:false,confirm:true},list,'rinkel-exact-match');changed=true;}
     if(changed)await write(record.state,record.revision);return reply(200,result);
    }
    const files={'':'reishuis.html','/':'reishuis.html','/reishuis.js':'reishuis.js','/reishuis.css':'reishuis.css','/reishuis-view.mjs':'reishuis-view.mjs','/reishuis-payments.mjs':'reishuis-payments.mjs','/reishuis-dossier-ui.js':'reishuis-dossier-ui.js','/reishuis-rinkel-ui.js':'reishuis-rinkel-ui.js'};
    if(files[path]){const file=files[path],ext=file.split('.').pop();res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});res.end(await readFile(new URL('./'+file,import.meta.url)));return true;}
    if(path==='/api/rinkel/media'||path==='/api/rinkel/audio'){
     const id=key(url.searchParams.get('id')),booking=key(url.searchParams.get('booking')),record=await read(),call=record.state.rinkelCalls?.[id];
     if(!call||call.booking!==booking||!(await bookings()).some(b=>b.id===booking))return reply(404,{error:'Gesprek niet gekoppeld aan dit dossier.'});
     if(!media.configured)return reply(200,{enabled:false});
     if(path==='/api/rinkel/media')return reply(200,{enabled:true,...await media.info(call)});
     const audio=await media.audio(call);res.writeHead(200,{'Content-Type':audio.type,'Content-Length':audio.bytes.length});res.end(audio.bytes);return true;
    }
    if(path==='/api/rinkel/dossier'){const id=key(url.searchParams.get('id'));if(!(await bookings()).some(b=>b.id===id))return reply(404,{error:'Boeking niet gevonden.'});return reply(200,rinkel.dossier((await read()).state,id));}
    if(path==='/api/dossier'){
     const id=key(url.searchParams.get('id'));if(!(await bookings()).some(b=>b.id===id))return reply(404,{error:'Boeking niet gevonden.'});
     const snapshot=await dossiers.get(id),record=await read();
     return reply(200,{id,revision:record.revision,sourceVersion:snapshot.version,syncedAt:new Date(snapshot.syncedAt).toISOString(),stale:snapshot.stale,refreshing:snapshot.refreshing,syncFailed:snapshot.syncFailed,dossier:mergeDossier(snapshot.data,record.state.dossiers?.[id])});
    }
    if(path==='/api/state'){
     const who=await actor(req),record=await read(),snapshot=await bookingCache.get(),today=dayInAmsterdam(new Date(clock())),bookingVersion=snapshot.version+':'+today;
     const meta={version:'0.3',revision:record.revision,csrf:csrf(req),bookingVersion,syncedAt:new Date(snapshot.syncedAt).toISOString(),refreshing:snapshot.refreshing,stale:snapshot.stale,syncFailed:snapshot.failed};
     if(url.searchParams.get('bookingVersion')===bookingVersion&&url.searchParams.get('revision')===String(record.revision))return reply(200,{...meta,unchanged:true});
     const list=snapshot.bookings.map(({photo,payments,updated,...b})=>({...b,hasPhoto:!!photo,photoVersion:photo?new URL(photo).pathname.split('/').pop():null,payment:paymentSummary(payments,today)}));
     const search=(url.searchParams.get('q')||'').slice(0,160),pages=(url.searchParams.get('pages')||'').split(',').map(Number);
     return reply(200,{...meta,rows:selectRows(list,record.state.preferences[who]||defaultRows,pages,search),statuses:[...new Set([...statuses,...list.map(b=>b.status)])],customers:record.state.customers,links:record.state.links,notes:record.state.notes,bookings:list});
    }
    if(path==='/api/photo'){
     const b=(await bookings()).find(b=>b.id===url.searchParams.get('id'));if(!b?.photo)return reply(404,{error:'Geen foto.'});
     const result=await photo(b.photo);res.writeHead(200,{'Content-Type':result.type});res.end(result.bytes);return true;
    }
    return reply(404,{error:'Niet gevonden.'});
   }
   if(req.method!=='POST'||path!=='/api/change')return reply(405,{error:'Methode niet toegestaan.'});
   if(req.headers.origin!==origin||!equal(req.headers['x-reishuis-csrf'],csrf(req))||req.headers['content-type']!=='application/json')return reply(403,{error:'Herlaad Reishuis en probeer opnieuw.'});
   let size=0,parts=[];for await(const part of req){size+=part.length;if(size>24000)return reply(413,{error:'Verzoek te groot.'});parts.push(part);}
   let input;try{input=JSON.parse(Buffer.concat(parts).toString());}catch{return reply(400,{error:'Ongeldig verzoek.'});}
   if(!input||!Number.isSafeInteger(input.revision)||input.revision<0)invalid();
   const who=await actor(req),record=await read();if(input.revision!==record.revision)return reply(409,{error:'Gegevens zijn gewijzigd. Herlaad en controleer je keuze.'});
   const list=await bookings();
   // Never trust a client-supplied source; only the authorized server snapshot can seed edits.
   if(input.action==='dossier'){
    const id=key(input.booking);if(!list.some(b=>b.id===id))invalid();const snapshot=await dossiers.get(id);
    if(input.sourceVersion!==snapshot.version)return reply(409,{error:'De bron is bijgewerkt. Heropen het dossier en controleer je wijziging.'});
    input.source=snapshot.data;
   }
   const state=input.action==='rinkel-link'?rinkel.linkCall(record.state,input,list,who):input.action==='rinkel-number-remove'?rinkel.removeNumber(record.state,input,who):applyChange(record.state,input,list,who);
   return reply(200,{revision:await write(state,record.revision)});
  }catch(e){return reply([400,409].includes(e.status)?e.status:503,{error:e.status===400?'Controleer de invoer en de bevestiging.':e.status===409?'Naam of koppeling is ambigu, of gegevens zijn gewijzigd. Herlaad en controleer.':'Reishuis is tijdelijk niet beschikbaar. Controleer de leesverbinding en opslag.'});}
 };
}
export const handleReishuis=createReishuisHandler();
