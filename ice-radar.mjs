// Public NDOV station observations only; no customer or booking information.
const coordinates={ASD:[4.9003,52.378],UT:[5.1103,52.0894],AH:[5.9008,51.985],AMF:[5.374,52.154],DV:[6.161,52.257],HGL:[6.794,52.262],SHL:[4.762,52.309],RTD:[4.469,51.925],BD:[4.78,51.595],EHV:[5.481,51.443],ZL:[6.091,52.505]};
export function iceRadar(rows,now=Date.now()){
 const groups=new Map();
 for(const r of rows){
  if(r.source!=='NDOV'||String(r.category).toUpperCase()!=='ICE'||!r.number||!Number.isFinite(r.plannedTimestamp)||!Number.isFinite(r.messageTimestamp))continue;
  if(r.plannedTimestamp<now-3*3600000||r.plannedTimestamp>now+12*3600000)continue;
  const key=`${r.serviceDate}|${r.rideId||r.number}`;
  const stops=groups.get(key)||new Map(),old=stops.get(r.stationShortCode);
  if(!old||old.messageTimestamp<r.messageTimestamp)stops.set(r.stationShortCode,r);
  groups.set(key,stops);
 }
 const trains=[...groups.entries()].map(([id,values])=>{
  const stops=[...values.values()].sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
  const next=stops.find(r=>!r.departed&&(r.expectedTimestamp||r.plannedTimestamp)>=now)||stops.at(-1);
  const stale=now-next.messageTimestamp>15*60000;
  return {id,number:next.number,from:stops[0].observedAt,to:next.to,routeLabel:'Vanaf eerste beschikbare Nederlandse halte',station:next.observedAt,coordinates:coordinates[next.stationShortCode]||null,delay:next.hasRealtime&&!stale?next.delay:null,cancelled:next.cancelled,stale,messageAt:new Date(next.messageTimestamp).toISOString(),plannedTimestamp:next.plannedTimestamp,stops:stops.map(r=>({station:r.observedAt,plannedTimestamp:r.plannedTimestamp,delay:r.hasRealtime&&now-r.messageTimestamp<=15*60000?r.delay:null,cancelled:r.cancelled,departed:r.departed}))};
 }).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
 return {source:'NDOV InfoPlus',generatedAt:new Date(now).toISOString(),total:trains.length,trains:trains.slice(0,8)};
}
