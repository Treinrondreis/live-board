import {createHash} from 'node:crypto';
import {sanityConfig} from './flora-sanity.mjs';
import {fetchHotels} from './reishuis-hotels.mjs';
import {readCatalog,writeCatalog} from './reishuis-store.mjs';
export const catalogVersion=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parts=now=>Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
export function catalogSlot(kind,now){const p=parts(now),date=`${p.year}-${p.month}-${p.day}`,time=p.hour+':'+p.minute;if(kind==='hotels'){const slot=['08:15','12:15','15:15'].filter(s=>s<=time).at(-1);return slot?date+' '+slot:null;}const season=p.month==='12'&&p.day>='20'||p.month==='01'&&p.day<='20';return season&&time>='03:15'?date+' 03:15':null;}
async function query(query,params={},fetcher=fetch,config=sanityConfig()){
 if(!config.token||config.project!=='il9cyh3m'||config.dataset!=='production')throw Error('Catalog read connection unavailable');
 const u=new URL('https://il9cyh3m.api.sanity.io/v2026-10-03/data/query/production');u.searchParams.set('query',query);u.searchParams.set('perspective','raw');for(const [k,v] of Object.entries(params))u.searchParams.set('$'+k,JSON.stringify(v));const r=await fetcher(u,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Catalog read failed');const {result}=await r.json();if(!Array.isArray(result))throw Error('Invalid catalog result');return result;
}
export async function fetchCatalogManifest(kind,options={}){
 const type=kind==='hotels'?'accommodation':'interrailBase',all=[];let after='';for(let i=0;i<1000;i++){const rows=await query('*[_type==$type && _id>$after] | order(_id asc)[0...100]{_id,_updatedAt}',{type,after},options.fetcher,options.config);for(const r of rows)if(typeof r._id!=='string'||typeof r._updatedAt!=='string')throw Error('Invalid manifest');all.push(...rows);if(rows.length<100)return all;const next=rows.at(-1)._id;if(next<=after)throw Error('Invalid manifest cursor');after=next;}throw Error('Manifest limit');
}
export async function fetchInterrailDocuments(ids,options={}){
 const rows=await query('*[_type=="interrailBase" && _id in $ids]{_id,_updatedAt,title,days,validity,unlimited,variants[]{_key,ageGroup,class,price}}',{ids},options.fetcher,options.config);
 return rows.map(r=>({sourceId:r._id,id:r._id.replace(/^drafts\./,''),updatedAt:r._updatedAt,title:typeof r.title==='string'?r.title:'',days:Number.isInteger(r.days)?r.days:null,validity:typeof r.validity==='string'?r.validity:'',unlimited:r.unlimited===true,variants:(Array.isArray(r.variants)?r.variants:[]).filter(v=>['1','2'].includes(v.class)&&['adult','senior','youth','child'].includes(v.ageGroup)&&typeof v.price==='number'&&Number.isFinite(v.price)&&v.price>=0).map(v=>({key:v._key,class:v.class,ageGroup:v.ageGroup,price:v.price}))}));
}
export function createCatalogService({read=readCatalog,write=writeCatalog,manifest=fetchCatalogManifest,documents=async(kind,ids)=>kind==='hotels'?fetchHotels({ids,documents:true}):fetchInterrailDocuments(ids),clock=Date.now}={}){
 const memory=new Map(),pending=new Map(),retry=new Map();
 async function sync(kind){
  if(pending.has(kind))return pending.get(kind);if((retry.get(kind)||0)>clock())throw Error('Catalog retry later');
  const task=(async()=>{const old=memory.get(kind)||await read(kind),index=await manifest(kind),ids=new Set(index.map(r=>r._id));if(ids.size!==index.length)throw Error('Duplicate manifest');const entries=(kind==='hotels'&& old?.formatVersion!==3?[]:old?.entries||[]).filter(r=>ids.has(r.sourceId)),changed=index.filter(r=>!entries.some(e=>e.sourceId===r._id&&e.updatedAt===r._updatedAt)).map(r=>r._id),updates=[];
   for(let i=0;i<changed.length;i+=25){const batch=changed.slice(i,i+25),rows=await documents(kind,batch);if(rows.length!==batch.length||new Set(rows.map(r=>r.sourceId)).size!==batch.length||rows.some(r=>!batch.includes(r.sourceId)||!index.some(m=>m._id===r.sourceId&&m._updatedAt===r.updatedAt)))throw Error('Catalog changed during read');updates.push(...rows);}
   const nextEntries=[...entries.filter(r=>!changed.includes(r.sourceId)),...updates].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)),unique=new Map();for(const r of nextEntries)if(!unique.has(r.id)||r.sourceId.startsWith('drafts.'))unique.set(r.id,r);const data=[...unique.values()],next={formatVersion:3,entries:nextEntries,data,version:catalogVersion(data),checkedAt:clock(),slot:catalogSlot(kind,clock())};await write(kind,next);memory.set(kind,next);retry.delete(kind);return next;
  })().catch(()=>{retry.set(kind,clock()+60000);throw Error('Catalog synchronization unavailable');}).finally(()=>pending.delete(kind));pending.set(kind,task);return task;
 }
 async function get(kind){if(!['hotels','interrail'].includes(kind))throw Error('Invalid catalog');let saved=memory.get(kind);if(!saved){saved=await read(kind);if(saved)memory.set(kind,saved);}if(kind==='hotels'&&saved?.formatVersion!==3){try{return await sync(kind);}catch(e){if(saved)return {...saved,data:saved.data.map(h=>({...h,pricingUnavailable:true}))};throw e;}}return saved||sync(kind);}
 return {get,sync,async tick(){for(const kind of ['hotels','interrail']){try{const saved=memory.get(kind)||await read(kind),slot=catalogSlot(kind,clock());if(!saved||kind==='hotels'&&saved.formatVersion!==3||slot&&(!saved.slot||slot>saved.slot))await sync(kind);}catch{/* Keep the last complete catalog; never log provider responses. */}}}};
}
export const reishuisCatalogs=createCatalogService();
export function startReishuisCatalogSync(){void reishuisCatalogs.tick();const timer=setInterval(()=>void reishuisCatalogs.tick(),60000);timer.unref();return timer;}
