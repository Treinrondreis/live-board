import {reportGroups,reportNumbers,aliasesFor} from './public/train-report-config.mjs';

const day = ms => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
const shift = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const invalid = message => Object.assign(Error(message),{status:400});
// Nightjet portions can be reported under the combined train number in NDOV.
const numberAliases = group => group.id==='nightjet-east'?{'421':'40421'}:group.id==='nightjet-west'?{'490':'40490'}:{};

export function reportSelection(filters,now=Date.now()) {
  const group=reportGroups.find(g=>g.id===filters.group);
  if(!group)throw invalid('Onbekende treingroep.');
  const station=filters.station || group.stations[0],source=filters.source || 'DB',days=Number(filters.days || 30);
  if(!group.stations.includes(station)||!['DB','NDOV'].includes(source)||![30,60,90].includes(days))throw invalid('Ongeldige selectie.');
  const to=shift(day(now),-1),from=shift(to,1-days);
  return {group,station,source,days,from,to,dates:Array.from({length:days},(_,i)=>shift(to,-i))};
}

// One arrival per day/train; never interpret an absent observation as a train not running.
export function buildTrainReport(selection,rows) {
  const {group,station,dates}=selection,primary=new Set(aliasesFor(station)),fallback=group.id==='berlin-east'&&station==='Berlin Hbf'?new Set(aliasesFor('Berlin Gesundbrunnen')):new Set();
  const sources=selection.source==='NDOV'?['NDOV','NDOV_RIT']:['DB'];
  const candidates=new Map(),aliases=numberAliases(group);
  for(const row of rows){
    if(!sources.includes(row.source)||row.event_mode!=='arrival'||!dates.includes(row.event_date)||!['ICE','NJ','IC','EC'].includes(String(row.category).toUpperCase()))continue;
    const isPrimary=primary.has(row.station);
    if(!isPrimary&&!fallback.has(row.station))continue;
    let latest,measured;
    try{latest=JSON.parse(row.payload);measured=row.measured_payload?JSON.parse(row.measured_payload):null;}catch{continue;}
    if(!Number.isFinite(latest.planned)||day(latest.planned)!==row.event_date)continue;
    // Only a realtime value for this exact planned stop may supply the delay.
    if(measured&&(measured.planned!==latest.planned||measured.number!==latest.number||measured.mode!=='arrival'))measured=null;
    const usable=!!latest.cancelled||!!(measured?.realtime&&!measured.cancelled&&Number.isFinite(measured.delay));
    const key=row.event_date+'|'+(aliases[row.train_number]||row.train_number);
    const candidate={row,latest,measured,rank:(usable?2:0)+(isPrimary?1:0)};
    const old=candidates.get(key);
    if(!old||candidate.rank>old.rank||candidate.rank===old.rank&&Number(row.last_seen)>Number(old.row.last_seen))candidates.set(key,candidate);
  }
  return {...Object.fromEntries(['station','source','days','from','to'].map(k=>[k,selection[k]])),group:group.id,rows:dates.map(date=>({date,cells:reportNumbers(group,date).map(number=>{
    const chosen=candidates.get(date+'|'+number);
    if(!chosen)return {number,status:'unknown'};
    const {row,latest,measured}=chosen;
    const common={number,station:latest.station,source:row.source,observedAt:Number(row.last_seen),planned:latest.planned};
    if(latest.cancelled)return {...common,status:'cancelled'};
    if(!measured?.realtime||measured.cancelled||!Number.isFinite(measured.delay))return {...common,status:'unknown'};
    return {...common,status:'measured',delay:measured.delay,observedAt:Number(row.measured_at),kind:measured.actual?'actual':'expected'};
  })}))};
}

export async function readTrainReport(q,filters,now=Date.now()) {
  const selection=reportSelection(filters,now);
  const numbers=[...new Set([...selection.group.trains,...Object.keys(numberAliases(selection.group)),...(selection.group.id==='swiss'?['1074','1072']:[])])];
  const stations=[...new Set([...aliasesFor(selection.station),...(selection.group.id==='berlin-east'&&selection.station==='Berlin Hbf'?aliasesFor('Berlin Gesundbrunnen'):[])])];
  const args=[selection.from,selection.to];
  const placeholders=values=>values.map(v=>{args.push(v);return '$'+args.length}).join(',');
  const numberSQL=placeholders(numbers),stationSQL=placeholders(stations),sourceSQL=placeholders(selection.source==='NDOV'?['NDOV','NDOV_RIT']:['DB']);
  const rows=await q(`SELECT event_date,source,train_number,category,station,event_mode,last_seen,measured_at,measured_payload,payload FROM train_stop_summaries WHERE event_date >= $1 AND event_date <= $2 AND event_mode='arrival' AND train_number IN (${numberSQL}) AND station IN (${stationSQL}) AND source IN (${sourceSQL})`,args);
  return buildTrainReport(selection,rows);
}
