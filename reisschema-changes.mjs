import {createHash} from 'node:crypto';

const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function localTime(time){
 if(!Number.isFinite(Number(time))||Number(time)<=0)return null;
 const p=Object.fromEntries(parts.formatToParts(Number(time)).map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function changeKey(legId,o){return createHash('sha256').update(JSON.stringify([legId,o.departure_date,o.departure_time,o.arrival_date,o.arrival_time,o.cancelled,o.connection_broken,o.backup_communicated])).digest('hex');}
export function observationFromPlans(leg,plans){
 const candidates=[];
 for(const plan of plans){
  const number=String(leg.train_number||'').match(/\d+[a-z]?$/i)?.[0];
  const category=String(leg.train_number||'').match(/^[a-z]+/i)?.[0];
  if(String(plan.trainNumber)!==number||!plan.category||normal(plan.category)!==normal(category)||!plan.completePlan||plan.planningAlternatives)continue;
  const stops=(plan.stops||[]).filter(s=>s.inLatestPlan!==false&&s.stopType!=='D');
  const starts=stops.filter(s=>normal(s.station)===normal(leg.from_station));
  const ends=stops.filter(s=>normal(s.station)===normal(leg.to_station));
  if(starts.length!==1||ends.length!==1||starts[0].sequence>=ends[0].sequence)continue;
  const dep=starts[0].departure?.planning,arr=ends[0].arrival?.planning;
  const d=localTime(dep?.time),a=localTime(arr?.time);
  if(!d||!a||d.date!==leg.travel_date)continue;
  const observed=Math.min(Number(dep.sourceTimestamp),Number(arr.sourceTimestamp));
  if(!Number.isFinite(observed)||observed<Date.parse(leg.created_at)||observed>Date.now()+300000)continue;
  candidates.push({departure_date:d.date,departure_time:d.time,arrival_date:a.date,arrival_time:a.time,cancelled:false,connection_broken:false,backup_communicated:false,source:plan.planningSource||dep.source||'Ritarchief',observed_at:new Date(observed).toISOString()});
 }
 // Ambiguous sources are not silently resolved, even if one appears newer.
 if(candidates.length!==1)return null;
 return candidates[0];
}
export async function enrichChanges(rows,lookup){
 const cache=new Map();
 const result=[];
 for(const row of rows){
  const number=String(row.train_number||'').match(/\d+[a-z]?$/i)?.[0];
  const key=number+'|'+row.travel_date;
  let observation=row.observation||null,archiveAvailable=false;
  if(number){
   if(!cache.has(key))cache.set(key,Promise.resolve().then(()=>lookup(number,row.travel_date)).catch(()=>null));
   const plans=await cache.get(key);
   if(plans){
    const candidate=observationFromPlans(row,plans);archiveAvailable=!!candidate;
    if(candidate&&(!observation||Date.parse(candidate.observed_at)>Date.parse(observation.observed_at)))observation=candidate;
   }
  }
  result.push({...row,observation,archive_available:archiveAvailable});
 }
 // Only prove a missed connection when the onward departure is already reached.
 for(const row of result){
  const next=result.filter(r=>r.version_id===row.version_id&&r.role!=='backup'&&row.role!=='backup'&&Number(r.sequence)>Number(row.sequence)).sort((a,b)=>a.sequence-b.sequence)[0];
  let o=row.observation?{...row.observation}:null;
  if(!o&&next?.observation&&normal(row.to_station)===normal(next.from_station)){
   const arrival=Date.parse((row.arrival_date||row.travel_date)+'T'+row.arrival_time+':00Z');
   const departure=Date.parse(next.observation.departure_date+'T'+next.observation.departure_time+':00Z');
   if(Number.isFinite(arrival)&&Number.isFinite(departure)&&arrival>=departure)o={departure_date:row.travel_date,departure_time:row.departure_time,arrival_date:row.arrival_date||row.travel_date,arrival_time:row.arrival_time,cancelled:false,connection_broken:false,backup_communicated:false,source:'Aansluitcontrole met aankomst uit reisschema; '+next.observation.source,observed_at:next.observation.observed_at,connection_calculated:true};
  }
  if(!o)continue;
  if(o.connection_calculated)o.connection_broken=false;
  if(next&&normal(row.to_station)===normal(next.from_station)){
   const arrival=Date.parse(o.arrival_date+'T'+o.arrival_time+':00Z');
   const departure=Date.parse((next.observation?.departure_date||next.travel_date)+'T'+(next.observation?.departure_time||next.departure_time)+':00Z');
   if(Number.isFinite(arrival)&&Number.isFinite(departure)&&arrival>=departure){if(!o.connection_broken)o.connection_calculated=true;o.connection_broken=true;}
  }
  o.change_key=changeKey(row.leg_id,o);row.observation=o;
  if(row.communication?.change_key!==o.change_key)row.communication=null;
 }
 return result;
}
