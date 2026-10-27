// Public NDOV station observations only; no customer or booking information.
const coordinates={ASD:[4.9003,52.378],UT:[5.1103,52.0894],AH:[5.9008,51.985],AMF:[5.374,52.154],DV:[6.161,52.257],HGL:[6.794,52.262],SHL:[4.762,52.309],RTD:[4.469,51.925],BD:[4.78,51.595],EHV:[5.481,51.443],ZL:[6.091,52.505]};
const fresh=(row,now)=>Number.isFinite(row.messageTimestamp)&&now-row.messageTimestamp>=-60000&&now-row.messageTimestamp<=15*60000;

// Interpolate only between two fresh forecasts after a reported departure.
// These departure-to-departure estimates are not GPS or confirmed arrivals.
export function estimateIcePosition(stops,now){
 for(let i=0;i<stops.length-1;i++){
  const a=stops[i],b=stops[i+1],start=a.expectedTimestamp,end=b.expectedTimestamp;
  const from=coordinates[a.stationShortCode],to=coordinates[b.stationShortCode];
  if(!a.departed||a.cancelled||b.cancelled||a.notBoardable||b.notBoardable||!a.hasRealtime||!b.hasRealtime||!fresh(a,now)||!fresh(b,now))continue;
  if(!from||!to||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>3*3600000||now<start||now>=end)continue;
  const fraction=(now-start)/(end-start);
  return {kind:'estimated',coordinates:from.map((v,j)=>v+(to[j]-v)*fraction),from:a.observedAt,to:b.observedAt,label:`Geschatte positie tussen ${a.observedAt} en ${b.observedAt}`,basis:'Tussen vertrekverwachtingen; rechte lijn, geen exacte spoorroute',messageAt:new Date(Math.min(a.messageTimestamp,b.messageTimestamp)).toISOString()};
 }
 const last=stops.filter(r=>r.departed&&r.plannedTimestamp<=now&&coordinates[r.stationShortCode]).at(-1);
 const report=last||stops.find(r=>coordinates[r.stationShortCode]);
 return {kind:'station',coordinates:report?coordinates[report.stationShortCode]:null,label:report?`Stationsmelding ${report.observedAt} · geen voertuiglocatie`:'Geen locatie beschikbaar',basis:'Geen betrouwbare schatting beschikbaar',messageAt:report?new Date(report.messageTimestamp).toISOString():null};
}
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
  const stale=!fresh(next,now);
  return {id,number:next.number,from:stops[0].observedAt,to:next.to,routeLabel:'Vanaf eerste beschikbare Nederlandse halte',station:next.observedAt,coordinates:coordinates[next.stationShortCode]||null,position:estimateIcePosition(stops,now),delay:next.hasRealtime&&!stale?next.delay:null,cancelled:next.cancelled,stale,messageAt:new Date(next.messageTimestamp).toISOString(),plannedTimestamp:next.plannedTimestamp,stops:stops.map(r=>({station:r.observedAt,plannedTimestamp:r.plannedTimestamp,delay:r.hasRealtime&&fresh(r,now)?r.delay:null,cancelled:r.cancelled,departed:r.departed}))};
 }).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
 return {source:'NDOV InfoPlus',generatedAt:new Date(now).toISOString(),total:trains.length,trains:trains.slice(0,8)};
}
