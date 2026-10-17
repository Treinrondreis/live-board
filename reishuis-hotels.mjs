import {imageURL} from './reishuis-data.mjs';
import {sanityConfig} from './flora-sanity.mjs';
const text=v=>typeof v==='string'?v.slice(0,20000):'';
const blocks=v=>Array.isArray(v)?v.map(b=>(b.children||[]).map(c=>text(c.text)).join('')).join('\n\n'):text(v);
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function normalizeHotel(h){
 return {id:h._id.replace(/^drafts\./,''),sourceId:h._id,updatedAt:text(h._updatedAt),title:text(h.title),photos:(h.photos||[]).map(imageURL).filter(Boolean),address:text(h.address),description:blocks(h.description),stars:number(h.stars),meals:text(h.meals),nearestStation:text(h.nearestStation),distanceToStation:number(h.distanceToStation),timeToStation:number(h.timeToStation),breakfast:number(h.apoBreakfastPrice),rooms:(h.rooms||[]).map((r,i)=>({key:text(r._key)||'room-'+i,title:text(r.title),description:blocks(r.description),guests:number(r.guests),prices:(r.prices||[]).map(p=>text(p.price)),apoRoom:r.apoRoom?{docId:text(r.apoRoom.docId).replace(/^drafts\./,''),path:text(r.apoRoom.path)}:null})),apoRooms:(h.apoRooms||[]).map(r=>({key:text(r._key),title:text(r.title),capacity:number(r.settings?.capacity),prices:(r.prices||[]).map(p=>({date:text(p.date),price:number(p.price),source:text(p.source),boardType:text(p.boardType),lastUpdate:text(p.lastUpdate)}))}))};
}
export function hotelWithLinkedRates(hotel,hotels){
 const rates=new Map(hotel.apoRooms.map(r=>[hotel.id+':'+r.key,{...r,origin:hotel.id,roomTitles:[]}])) ,unresolved=[];
 for(const room of hotel.rooms){if(!room.apoRoom)continue;const key=room.apoRoom.path.match(/^apoRooms\.([a-zA-Z0-9_-]+)$/)?.[1],source=hotels.find(h=>h.id===room.apoRoom.docId),rate=source?.apoRooms.find(r=>r.key===key);if(!rate){unresolved.push(room.title);continue;}const id=source.id+':'+key;if(!rates.has(id))rates.set(id,{...rate,origin:source.id,roomTitles:[]});rates.get(id).roomTitles.push(room.title);}
 return {...hotel,apoRooms:[...rates.values()],unresolved};
}
// Fixed field projection excludes booking records, credentials and job history.
export async function fetchHotels({fetcher=fetch,config=sanityConfig(),ids,documents=false}={}){
 if(!config.token||config.project!=='il9cyh3m'||config.dataset!=='production')throw Error('Hotel read connection unavailable');
 let after='',all=[];
 for(let page=0;page<1000;page++){
  const u=new URL('https://il9cyh3m.api.sanity.io/v2026-10-03/data/query/production');u.searchParams.set('perspective','raw');u.searchParams.set('$after',JSON.stringify(after));
  u.searchParams.set('query','*[_type=="accommodation" && _id > $after'+(ids?' && _id in $ids':'')+'] | order(_id asc)[0...25]{_id,_updatedAt,title,"photos":images[]{"url":coalesce(@->url,@->image.asset->url,image.asset->url,asset->url)}.url,address,description,stars,meals,nearestStation,distanceToStation,timeToStation,apoBreakfastPrice,rooms[]{_key,title,description,guests,prices[]{price},apoRoom{docId,path}},apoRooms[]{_key,title,settings{capacity},prices[]{date,price,source,boardType,lastUpdate}}}');
  if(ids)u.searchParams.set('$ids',JSON.stringify(ids));const r=await fetcher(u,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Hotel read unavailable');const {result}=await r.json();if(!Array.isArray(result))throw Error('Invalid hotel response');all.push(...result);
  if(result.length<25){if(documents)return all.map(normalizeHotel);const unique=new Map();for(const h of all){if(typeof h._id!=='string')throw Error('Invalid hotel');const v=normalizeHotel(h);if(!unique.has(v.id)||h._id.startsWith('drafts.'))unique.set(v.id,v);}return [...unique.values()];}
  const next=result.at(-1)?._id;if(typeof next!=='string'||next<=after)throw Error('Invalid hotel cursor');after=next;
 }throw Error('Hotel page limit');
}
export function createHotelCache({fetchHotels:read=fetchHotels,clock=Date.now}={}){
 let saved,pending;
 return async()=>{if(!saved||clock()-saved.syncedAt>300000){if(!pending)pending=read().then(hotels=>saved={hotels,syncedAt:clock()}).finally(()=>pending=null);if(!saved)await pending;else void pending.catch(()=>{});}return {...saved,refreshing:!!pending};};
}
