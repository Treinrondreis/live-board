import {hotelDashboard,unlinkedHotels} from './reishuis-hotel-dashboard.mjs';
import {reishuisResources} from './reishuis-resources.mjs';
import {hotelCalendar} from './reishuis-hotel-pricing.mjs';
import {hotelMatches,hotelStays,hotelsForTitle} from './reishuis-hotel-links.mjs';
import {reishuisCatalogs} from './reishuis-catalogs.mjs';
import {quoteChange,applyQuote,pricingFingerprint} from './reishuis-repricing.mjs';
import {audioRange,createRinkelMedia} from './reishuis-rinkel-media.mjs';
import {createHotelCache,fetchHotels,hotelWithLinkedRates} from './reishuis-hotels.mjs';
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
 state.history.push({at:new Date().toISOString(),actor,action:input.action,...(['link','unlink','dossier'].includes(input.action)?{booking:input.booking}:input.action==='note'&&input.kind==='booking'?{booking:input.id}:{}),...(input.action==='dossier'?{section:input.section,item:typeof input.item==='string'?input.item.slice(0,160):null,fields:['personal','todo','line','notes','contacts'].includes(input.section)?Object.keys(input.values||{}):[],...(input.section==='todo'&&typeof input.values?.status==='string'?{status:input.values.status}:{})}:{}),...(input.action==='merge'?{from:input.from,to:input.to}:{})});state.history=state.history.slice(-500);
 return state;
}
export function createReishuisHandler({authenticate=async req=>(await import('./admin-security.mjs')).adminAuthenticated(req,'reishuis'),actor=async req=>(await import('./admin-security.mjs')).authenticatedActor(req),read=readReishuis,write=writeReishuis,readSnapshot=readBookingSnapshot,writeSnapshot=writeBookingSnapshot,fetchBookings=fetchReishuisBookings,readDossier=readDossierSnapshot,writeDossier=writeDossierSnapshot,fetchDossier=fetchReishuisDossier,rinkel=rinkelIncoming,media=createRinkelMedia(),fetchHotels:hotelSource=fetchHotels,catalogs=reishuisCatalogs,resources=reishuisResources,fetcher=fetch,origin=process.env.SEINHUIS_PUBLIC_ORIGIN||'https://treinbord.up.railway.app',clock=Date.now}={}){
 let dashboardCache;
 const bookingCache=createBookingsCache({readSnapshot,writeSnapshot,fetchBookings,clock});
 const hotels=hotelSource!==fetchHotels?createHotelCache({clock,fetchHotels:hotelSource}):async()=>{const c=await catalogs.get('hotels');return {hotels:c.data,syncedAt:c.checkedAt,version:c.version};};
 const bookings=async()=>(await bookingCache.get()).bookings;
 const commit=async(state,revision)=>{const entry=state.history.at(-1);if(entry)entry.id??=randomUUID();if(typeof entry?.booking==='string'&&/^[-a-zA-Z0-9_.]{1,160}$/.test(entry.booking)&&!['__proto__','constructor','prototype'].includes(entry.booking)){state.dossiers??={};state.dossiers[entry.booking]??={};const local=state.dossiers[entry.booking];local.audit??=[];local.audit.push({...entry});}return write(state,revision);};
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
    if(path==='/api/interrail'){const c=await catalogs.get('interrail');return reply(200,{passes:c.data,syncedAt:c.checkedAt,version:c.version});}
    if(path==='/api/activity'){const record=await read();return reply(200,{events:record.state.history.slice().reverse()});}
    if(path==='/api/access')return reply(200,{ok:true,user:await actor(req)});
    if(path==='/api/resources'||path==='/api/letter'){const id=key(url.searchParams.get('id')),list=await bookings(),booking=list.find(b=>b.id===id);if(!booking)return reply(404,{error:'Boeking niet gevonden.'});if(path==='/api/resources')return reply(200,await resources.overview(booking,list));const bytes=await resources.letter(id,key(url.searchParams.get('document')));res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename=brief.pdf'});res.end(bytes);return true;}
    if(path==='/api/hotel-dashboard'||path==='/api/hotel-unlinked'){const [snapshot,record,catalog,who]=await Promise.all([bookingCache.get(),read(),hotels(),actor(req)]),period=url.searchParams.get('period')||'upcoming';if(!['upcoming','past','all'].includes(period))invalid();const today=dayInAmsterdam(new Date(clock())),cacheKey=JSON.stringify([snapshot.version,record.revision,catalog.version||catalog.syncedAt,today,period]);if(dashboardCache?.key!==cacheKey)dashboardCache={key:cacheKey,data:hotelDashboard(snapshot.bookings,record.state,catalog.hotels,today,period)};const {unlinked,...overview}=dashboardCache.data;if(path==='/api/hotel-unlinked'){const page=Number(url.searchParams.get('page')||0);if(!Number.isSafeInteger(page)||page<0||page>100000)invalid();return reply(200,{rows:unlinked.slice(page*25,page*25+25),total:unlinked.length,page,pages:Math.max(1,Math.ceil(unlinked.length/25))});}return reply(200,{...overview,unlinkedCount:unlinked.length,preferences:record.state.hotelPreferences?.[who]||{},revision:record.revision,csrf:csrf(req),syncedAt:snapshot.syncedAt,tariffsSyncedAt:catalog.syncedAt});}
    if(path==='/api/hotels'){const data=await hotels();return reply(200,{...data,hotels:data.hotels.map(({apoRooms,photos,description,rooms,...h})=>({...h,photoCount:photos.length,rooms:rooms.map(({key,title,titleShort,guests})=>({key,title,titleShort,guests})),apoRooms:apoRooms.map(({prices,...r})=>({...r,priceCount:prices.length}))}))});}
    if(path==='/api/hotel-stays'){const data=await hotels(),id=key(url.searchParams.get('id'));if(!data.hotels.some(h=>h.id===id))return reply(404,{error:'Hotel niet gevonden.'});const snapshot=await bookingCache.get(),record=await read(),period=url.searchParams.get('period')||'upcoming',page=Number(url.searchParams.get('page')||0);if(!['upcoming','past','cancelled'].includes(period)||!Number.isSafeInteger(page)||page<0||page>100000)invalid();const result=hotelStays(snapshot.bookings,record.state,data.hotels,id,dayInAmsterdam(new Date(clock())),period,page);return reply(200,{...result,unindexed:snapshot.bookings.reduce((n,b)=>n+(b.hotelTodosUnindexed||0),0),tariffsSyncedAt:data.syncedAt,syncedAt:new Date(snapshot.syncedAt).toISOString(),refreshing:snapshot.refreshing,incomplete:snapshot.bookings.some(b=>!Array.isArray(b.hotelTodos)||!Array.isArray(b.hotelFinancialLines))});}
    if(path==='/api/hotel-calendar'){const data=await hotels(),hotel=data.hotels.find(h=>h.id===url.searchParams.get('id')),room=hotel?.rooms.find(r=>r.key===url.searchParams.get('room'));if(!room)return reply(404,{error:'Hotel of kamer niet gevonden.'});const result=hotelCalendar(hotel,room,url.searchParams.get('month'),data.hotels,{provider:url.searchParams.get('provider')||'',board:url.searchParams.get('board')||''});if(!result)invalid();return reply(200,{...result,syncedAt:data.syncedAt});}
    if(path==='/api/hotel-photo'){const data=await hotels(),hotel=data.hotels.find(h=>h.id===url.searchParams.get('id')),index=Number(url.searchParams.get('index'));if(!hotel||!Number.isInteger(index)||index<0||!hotel.photos[index])return reply(404,{error:'Geen foto.'});const result=await photo(hotel.photos[index]);res.writeHead(200,{'Content-Type':result.type});res.end(result.bytes);return true;}
    if(path==='/api/hotel'){const data=await hotels(),hotel=data.hotels.find(h=>h.id===url.searchParams.get('id'));return hotel?reply(200,{hotel:{...hotelWithLinkedRates(hotel,data.hotels),photos:undefined,photoCount:hotel.photos.length},syncedAt:data.syncedAt,refreshing:data.refreshing}):reply(404,{error:'Hotel niet gevonden.'});}
    if(path==='/api/rinkel'){if(!rinkel.configured)return reply(200,{enabled:false});const [list,record]=await Promise.all([bookings(),read()]);return reply(200,await rinkel.poll({cursor:url.searchParams.get('cursor'),bookings:list,state:record.state}));}
    const files={'':'reishuis.html','/':'reishuis.html','/reishuis.js':'reishuis.js','/boekingen':'reishuis-bookings.html','/boekingen/':'reishuis-bookings.html','/reishuis-shell.js':'reishuis-shell.js','/reisschema-table.mjs':'reisschema-table.mjs','/reisschema-number-policy.mjs':'reisschema-number-policy.mjs','/punctuality-view.mjs':'punctuality-view.mjs','/reishuis-hotel-landing.js':'reishuis-hotel-landing.js','/hotels':'reishuis-hotels.html','/hotels/':'reishuis-hotels.html','/reishuis-hotels-page.js':'reishuis-hotels-page.js','/reishuis.css':'reishuis.css','/reishuis-view.mjs':'reishuis-view.mjs','/reishuis-payments.mjs':'reishuis-payments.mjs','/reishuis-dossier-ui.js':'reishuis-dossier-ui.js','/reishuis-rinkel-ui.js':'reishuis-rinkel-ui.js','/reishuis-hotels-ui.js':'reishuis-hotels-ui.js','/reishuis-repricing-ui.js':'reishuis-repricing-ui.js'};
    if(files[path]){const file=files[path],ext=file.split('.').pop();res.writeHead(200,{'Content-Type':({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css'})[ext]+'; charset=utf-8'});res.end(await readFile(new URL('./'+file,import.meta.url)));return true;}
    if(path==='/api/rinkel/media'||path==='/api/rinkel/audio'){
     const id=key(url.searchParams.get('id')),booking=key(url.searchParams.get('booking')),record=await read(),call=record.state.rinkelCalls?.[id];
     if(!call||call.booking!==booking||!(await bookings()).some(b=>b.id===booking))return reply(404,{error:'Gesprek niet gekoppeld aan dit dossier.'});
     if(!media.configured)return reply(200,{enabled:false});
     if(path==='/api/rinkel/media')return reply(200,{enabled:true,...await media.info(call)});
     const audio=await media.audio(call);if(url.searchParams.get('check')==='1')return reply(200,{available:true,type:audio.type,bytes:audio.bytes.length});const range=audioRange(req.headers.range,audio.bytes.length),headers={'Content-Type':audio.type,'Accept-Ranges':'bytes','Content-Disposition':'inline; filename=gesprek'};if(range===false){res.writeHead(416,{...headers,'Content-Range':'bytes */'+audio.bytes.length,'Content-Length':0});res.end();return true;}const bytes=range?audio.bytes.subarray(range.start,range.end+1):audio.bytes;res.writeHead(range?206:200,{...headers,'Content-Length':bytes.length,...(range?{'Content-Range':'bytes '+range.start+'-'+range.end+'/'+audio.bytes.length}:{})});res.end(bytes);return true;
    }
    if(path==='/api/rinkel/dossier'){const id=key(url.searchParams.get('id'));if(!(await bookings()).some(b=>b.id===id))return reply(404,{error:'Boeking niet gevonden.'});return reply(200,rinkel.dossier((await read()).state,id));}
    if(path==='/api/dossier'){
     const id=key(url.searchParams.get('id')),booking=(await bookings()).find(b=>b.id===id);if(!booking)return reply(404,{error:'Boeking niet gevonden.'});
     const snapshot=await dossiers.get(id),record=await read(),dossier=mergeDossier(snapshot.data,record.state.dossiers?.[id]);if(dossier.todos.some(t=>t.tag==='hotel'&&!t.component&&!t.review&&!t.archived)){try{const catalog=await hotels(),matches=hotelMatches(dossier,catalog.hotels,record.state.dossiers?.[id]?.components,snapshot.data);for(const t of dossier.todos)if(matches[t.id])t.hotelMatch=matches[t.id];}catch{dossier.hotelMatchUnavailable=true;}}
     return reply(200,{id,revision:record.revision,sourceVersion:snapshot.version,syncedAt:new Date(snapshot.syncedAt).toISOString(),stale:snapshot.stale,refreshing:snapshot.refreshing,syncFailed:snapshot.syncFailed,booking:{index:booking.index,name:booking.name,status:booking.status,departure:booking.departure,return:booking.return,hasPhoto:!!booking.photo},dossier,audit:[...new Map([...record.state.history.filter(e=>e.booking===id),...(record.state.dossiers?.[id]?.audit||[])].map(e=>[JSON.stringify(e),e])).values()].sort((a,b)=>b.at.localeCompare(a.at))});
    }
    if(path==='/api/state'){
     const who=await actor(req),record=await read(),snapshot=await bookingCache.get(),today=dayInAmsterdam(new Date(clock())),bookingVersion=snapshot.version+':'+today;
     const meta={version:'0.3',user:who,revision:record.revision,csrf:csrf(req),bookingVersion,syncedAt:new Date(snapshot.syncedAt).toISOString(),refreshing:snapshot.refreshing,stale:snapshot.stale,syncFailed:snapshot.failed};
     if(url.searchParams.get('bookingVersion')===bookingVersion&&url.searchParams.get('revision')===String(record.revision))return reply(200,{...meta,unchanged:true});
     const list=snapshot.bookings.map(({photo,payments,updated,hotelTodos,hotelTodosUnindexed,hotelFinancialLines,...b})=>({...b,hasPhoto:!!photo,photoVersion:photo?new URL(photo).pathname.split('/').pop():null,payment:paymentSummary(payments,today)}));
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
   if(input.action==='rinkel-history'){
    if(!media.configured)return reply(200,{enabled:false,calls:[]});
    if(typeof input.number!=='string'||!/^\+[1-9]\d{7,14}$/.test(input.number)||!Number.isInteger(input.page)||input.page<1||input.page>100)invalid();
    const history=await media.history(input.number,input.page);return reply(200,{enabled:true,calls:rinkel.history(history.rows),hasMore:history.hasMore});
   }
   const list=await bookings();
   if(input.action==='rinkel-link-many'){const booking=key(input.booking);if(!Array.isArray(input.calls)||input.calls.length<1||input.calls.length>25||new Set(input.calls).size!==input.calls.length||input.calls.some(c=>typeof c!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(c)||['__proto__','constructor','prototype'].includes(c))||typeof input.remember!=='boolean'||input.confirm!==true)invalid();const next=structuredClone(record.state);for(const call of input.calls)rinkel.linkCall(next,{action:'rinkel-link',call,booking,remember:input.remember,confirm:true},list,who);next.dossiers??={};next.dossiers[booking]??={};next.dossiers[booking].audit??=[];for(const entry of next.history.slice(-input.calls.length,-1)){entry.id??=randomUUID();next.dossiers[booking].audit.push({...entry});}return reply(200,{revision:await commit(next,record.revision),linked:input.calls.length});}
   if(input.action==='hotel-preferences'){const p=input.preferences;if(!p||typeof p!=='object'||Object.keys(p).some(k=>!['country','sort','pinned','rowCountry','period','rows'].includes(k))||typeof p.country!=='string'||!/^$|^[A-Z]{2}$/.test(p.country)||!['booked','name'].includes(p.sort)||typeof p.pinned!=='boolean'||!/^[A-Z]{2}$/.test(p.rowCountry)||!['upcoming','past','all'].includes(p.period)||p.rows!==undefined&&(!Array.isArray(p.rows)||p.rows.length<1||p.rows.length>5||p.rows.some(r=>!r||!['hotels','country','savings'].includes(r.type)||typeof r.country!=='string'||!/^$|^[A-Z]{2}$/.test(r.country)||Object.keys(r).some(k=>!['type','country'].includes(k)))))invalid();record.state.hotelPreferences??={};record.state.hotelPreferences[who]={...p};record.state.history.push({at:new Date(clock()).toISOString(),actor:who,action:'hotel-preferences'});record.state.history=record.state.history.slice(-500);return reply(200,{revision:await commit(record.state,record.revision)});}
   if(input.action==='assign-hotel'){const id=key(input.booking),todo=key(input.todo),hotel=key(input.hotel);if(!list.some(b=>b.id===id))invalid();const snapshot=await dossiers.get(id);if(snapshot.version!==input.sourceVersion)return reply(409,{error:'Bron gewijzigd. Heropen en controleer de koppeling.'});const catalog=await hotels(),d=mergeDossier(snapshot.data,record.state.dossiers?.[id]),t=d.todos.find(t=>t.id===todo&&!t.review&&!t.archived&&!t.sourceRemoved&&t.tag==='hotel');if(!t||t.component?.hotel||t.hotelLink||hotelsForTitle(t.title,catalog.hotels).length===1||!catalog.hotels.some(h=>h.id===hotel))invalid();record.state.dossiers??={};record.state.dossiers[id]??={};record.state.dossiers[id].hotelLinks??={};record.state.dossiers[id].hotelLinks[todo]=hotel;record.state.history.push({at:new Date(clock()).toISOString(),actor:who,action:'assign-hotel',booking:id,item:todo});record.state.history=record.state.history.slice(-500);return reply(200,{revision:await commit(record.state,record.revision)});}
   if(input.action==='match-hotels'){
    const id=key(input.booking);if(!list.some(b=>b.id===id))invalid();const snapshot=await dossiers.get(id);if(snapshot.version!==input.sourceVersion)return reply(409,{error:'De bron is bijgewerkt. Heropen het dossier.'});
    const catalog=await hotels(),local=record.state.dossiers?.[id]||{},matches=hotelMatches(mergeDossier(snapshot.data,local),catalog.hotels,local.components,snapshot.data),links=Object.entries(matches).filter(([id,m])=>m.component&&!local.components?.[id]);
    if(!links.length)return reply(200,{revision:record.revision});record.state.dossiers??={};record.state.dossiers[id]??={};record.state.dossiers[id].components={...local.components,...Object.fromEntries(links.map(([id,m])=>[id,{...m.component,automatic:true}]))};record.state.history.push({at:new Date(clock()).toISOString(),actor:who,action:'hotel-match',booking:id,count:links.length});record.state.history=record.state.history.slice(-500);return reply(200,{revision:await commit(record.state,record.revision)});
   }
   if(['reprice-preview','reprice-commit'].includes(input.action)){
    const id=key(input.booking);if(!list.some(b=>b.id===id))invalid();const snapshot=await dossiers.get(id);if(snapshot.version!==input.sourceVersion)return reply(409,{error:'De bron is bijgewerkt. Heropen het dossier.'});
    const [h,p]=await Promise.all([catalogs.get('hotels'),catalogs.get('interrail')]),plan=quoteChange(snapshot.data,record.state.dossiers?.[id]||{},input.edit,{hotels:h.data,interrail:p.data});
    const expires=input.action==='reprice-preview'?clock()+600000:Number(String(input.quote||'').split('.')[0]);
    const fingerprint=pricingFingerprint({actor:who,csrf:csrf(req),id,revision:record.revision,sourceVersion:snapshot.version,hotels:h.version,interrail:p.version,edit:input.edit,plan,expires}),signature=createHmac('sha256',csrfSecret).update('reprice-v1:'+fingerprint).digest('hex'),quote=expires+'.'+signature;
    if(input.action==='reprice-preview')return reply(200,{plan,quote});
    if(!Number.isSafeInteger(expires)||expires<clock()||expires>clock()+600000||!equal(input.quote,quote))return reply(409,{error:'De berekening is verlopen of gewijzigd. Klik opnieuw op Herberekenen.'});
    if(plan.warnings.length&&input.edit.ackWarnings!==true)return reply(400,{error:'Bevestig eerst de waarschuwingen en bereken opnieuw.'});
    const next=applyQuote(record.state,id,snapshot.data,plan,who,new Date(clock()).toISOString());return reply(200,{revision:await commit(next,record.revision)});
   }
   // Never trust a client-supplied source; only the authorized server snapshot can seed edits.
   if(input.action==='dossier'){
    const id=key(input.booking);if(!list.some(b=>b.id===id))invalid();const snapshot=await dossiers.get(id);
    if(input.sourceVersion!==snapshot.version)return reply(409,{error:'De bron is bijgewerkt. Heropen het dossier en controleer je wijziging.'});
    input.source=snapshot.data;
   }
   if(input.action==='rinkel-link'&&input.confirm===true&&input.remember===false&&record.state.rinkelCalls?.[key(input.call)]?.booking===input.booking)return reply(200,{revision:record.revision});
   const state=input.action==='rinkel-link'?rinkel.linkCall(record.state,input,list,who):input.action==='rinkel-number-remove'?rinkel.removeNumber(record.state,input,who):applyChange(record.state,input,list,who);
   return reply(200,{revision:await commit(state,record.revision)});
  }catch(e){if(e.reishuisSafe)return reply(e.status||400,{error:e.message});if(Number.isInteger(e.rinkelStatus))return reply(502,{error:'Rinkel weigert het leesverzoek (HTTP '+e.rinkelStatus+'). Controleer de API-toegang.'});if(e.rinkelShape)return reply(502,{error:'Rinkel geeft een onverwacht formaat voor de gesprekshistorie.'});return reply([400,409].includes(e.status)?e.status:503,{error:e.status===400?'Controleer de invoer en de bevestiging.':e.status===409?'Naam of koppeling is ambigu, of gegevens zijn gewijzigd. Herlaad en controleer.':'Reishuis is tijdelijk niet beschikbaar. Controleer de leesverbinding en opslag.'});}
 };
}
export const handleReishuis=createReishuisHandler();
