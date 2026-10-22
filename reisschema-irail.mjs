// Only public train/station/date information is sent to iRail. No dossier identifiers.
import {trainDigits} from './reisschema-number-policy.mjs';
const normalized=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const number=s=>String(s||'').replace(/^BE\.NMBS\./,'').replace(/\s/g,'').toUpperCase();
const list=v=>Array.isArray(v)?v:v?[v]:[];
const dateParam=d=>d.slice(8,10)+d.slice(5,7)+d.slice(2,4);
const localClock=seconds=>{
 if(!/^\d+$/.test(String(seconds)))return null;
 const date=new Date(Number(seconds)*1000);if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
};
const names=s=>[s.station,s.name,s.standardname,s.stationinfo?.name,s.stationinfo?.standardname].filter(Boolean).flatMap(s=>String(s).split('/')).map(normalized);
export function parseIrailVehicle(data,leg,meta){
 const evidence=JSON.stringify({source:'iRail',downloaded_at:meta.loadedAt,source_modified:meta.loadedAt,vehicle:data.vehicle,query_date:meta.queryDate});
 const fail=reason=>({reason,sources:[evidence]});
 const exact=trainDigits(data.vehicle)===trainDigits(leg.train_number);
 const stops=list(data.stops?.stop),starts=stops.map((s,i)=>({s,i})).filter(({s})=>names(s).includes(normalized(leg.from_station))),ends=stops.map((s,i)=>({s,i})).filter(({s})=>names(s).includes(normalized(leg.to_station)));
 if(starts.length!==1||ends.length!==1)return fail('iRail: dubbelzinnige stations in de rit');
 const pairs=[];
 for(const start of starts)for(const end of ends){
  if(start.i>=end.i)continue;
  const departure=localClock(start.s.scheduledDepartureTime),arrival=localClock(end.s.scheduledArrivalTime);
  if(!departure||!arrival||departure.date!==leg.travel_date||departure.date+'T'+departure.time>arrival.date+'T'+arrival.time)continue;
  pairs.push({start,end,departure,arrival});
 }
 if(pairs.length!==1)return fail('iRail: geen volledige, eenduidige rit op de gevraagde datum');
 const {start,end,departure,arrival}=pairs[0];
 if(!exact&&(departure.time!==leg.departure_time||arrival.time!==leg.arrival_time||arrival.date!==(leg.arrival_date||leg.travel_date)))return fail('iRail: ander nummer niet eenduidig op oorspronkelijke tijden gekoppeld');
 // A disappearing match is not a cancellation. Explicit endpoint cancellation flags are required.
 if(!['0','1'].includes(String(start.s.departureCanceled))||!['0','1'].includes(String(end.s.arrivalCanceled)))return fail('iRail: uitvalstatus niet bevestigd');
 return {observation:{departure_date:departure.date,departure_time:departure.time,arrival_date:arrival.date,arrival_time:arrival.time,cancelled:String(start.s.departureCanceled)==='1'||String(end.s.arrivalCanceled)==='1',connection_broken:false,backup_communicated:false,source:'iRail',observed_at:meta.loadedAt,train_number:number(data.vehicle)},sources:[evidence]};
}
export function createIrailSource({fetcher=fetch,clock=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const cache=new Map();let lastRequest=-Infinity,blocked=false,requests=0;
 async function request(path,params){
  const url=new URL(path,'https://api.irail.be/v1/');for(const [key,value] of Object.entries({...params,format:'json',lang:'nl'}))url.searchParams.set(key,value);
  const key=url.href,previous=cache.get(key);if(previous&&clock()<previous.until)return previous.value;
  if(blocked||requests>=250)throw Error('iRail-aanvraagbudget bereikt');
  await pause(Math.max(0,1100-(clock()-lastRequest)));lastRequest=clock();requests++;
  const response=await fetcher(url.href,{redirect:'error',headers:{'User-Agent':'Treinrondreis-controle/1.0 (https://www.treinrondreis.nl; contact@treinrondreis.nl)','Accept':'application/json'},signal:AbortSignal.timeout(20000)});
  if(response.status===429){blocked=true;throw Error('iRail aanvraaglimiet');}
  if(!response.ok)throw Error('iRail niet bereikbaar');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('iRail antwoord te groot');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const data=JSON.parse(Buffer.concat(parts).toString('utf8')),timestamp=Number(data.timestamp)*1000;
  if(data.error||!Number.isFinite(timestamp)||clock()-timestamp>4*3600000||timestamp>clock()+60000)throw Error('iRail antwoord niet vers bevestigd');
  const maxAge=Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]||0);
  data._retrievedAt=new Date(clock()).toISOString();
  cache.set(key,{value:data,until:clock()+Math.max(60000,Math.min(maxAge*1000,4*3600000))});return data;
 }
 return {async lookup(leg,heartbeat=async()=>{}){
  try{
   await heartbeat();const catalogue=await request('stations',{}),candidates=list(catalogue.station).filter(s=>names(s).includes(normalized(leg.from_station)));
   if(candidates.length!==1)return {reason:'iRail: vertrekstation niet eenduidig herkend',sources:[]};
   const board=await request('liveboard',{id:candidates[0].id,date:dateParam(leg.travel_date),time:leg.departure_time?.replace(':','')||'0000',arrdep:'departure'});
   const departures=list(board.departures?.departure).filter(d=>!String(d.vehicle).startsWith('BE.NMBS.BUS'));
   const numbered=departures.filter(d=>trainDigits(d.vehicle)===trainDigits(leg.train_number));
   const candidateDepartures=numbered.length?numbered:departures.filter(d=>localClock(d.time)?.date===leg.travel_date&&localClock(d.time)?.time===leg.departure_time);
   const ids=[...new Set(candidateDepartures.map(d=>d.vehicle))];
   if(!ids.length||ids.length>4)return {reason:'iRail: trein niet eenduidig gevonden; NMBS nodig',sources:[]};
   const matches=[];for(const id of ids){await heartbeat();const data=await request('vehicle',{id,date:dateParam(leg.travel_date)}),result=parseIrailVehicle(data,leg,{loadedAt:data._retrievedAt,queryDate:leg.travel_date});if(result.observation)matches.push(result);}
   return matches.length===1?matches[0]:{reason:'iRail: geen unieke volledige rit; NMBS nodig',sources:[]};
  }catch{return {reason:'iRail niet bereikbaar of niet bruikbaar; NMBS nodig',sources:[]};}
 }};
}
