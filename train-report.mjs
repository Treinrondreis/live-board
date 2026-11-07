import {reportGroups,reportNumbers,aliasesFor,normalizeStation,defaultReportSource} from './public/train-report-config.mjs';

const day = ms => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
const shift = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const invalid = message => Object.assign(Error(message),{status:400});
// Nightjet portions can be reported under the combined train number in NDOV.
const numberAliases = group => group.id==='nightjet-east'?{'421':'40421'}:group.id==='nightjet-west'?{'490':'40490'}:{};

export function reportSelection(filters,now=Date.now()) {
  const group=reportGroups.find(g=>g.id===filters.group);
  if(!group)throw invalid('Onbekende treingroep.');
  const station=filters.station || group.stations[0],source=filters.source || defaultReportSource(group),days=Number(filters.days || 30);
  if(!group.stations.includes(station)||!['DB','NDOV'].includes(source)||![30,60,90].includes(days))throw invalid('Ongeldige selectie.');
  const to=shift(day(now),-1),from=shift(to,1-days);
  return {group,station,source,days,from,to,dates:Array.from({length:days},(_,i)=>shift(to,-i))};
}

// The full journey archive has arrival history that departure-board summaries omit.
// Read only explicit realtime/measurement/realized fields, never planning as +0.
export function journeyReportRows(journeys,selection){
  const rows=[],stations=new Set([...aliasesFor(selection.station),...(selection.group.id==='berlin-east'&&selection.station==='Berlin Hbf'?aliasesFor('Berlin Gesundbrunnen'):[])]);
  const accepted=selection.source==='NDOV'?['NDOV','NDOV_RIT']:['DB'];
  for(const row of journeys){
    let state;try{state=JSON.parse(row.state_json);}catch{continue;}
    for(const stop of state.stops||[]){
      if(!stop.station||!stations.has(normalizeStation(stop.station)))continue;
      const a=stop.arrival;if(!a)continue;
      const events=[a.realtime&&{...a.realtime,expected:a.realtime.expectedTime},a.measurement&&{...a.measurement,expected:a.measurement.expectedTime,baseline:a.measurement.plannedTime},a.realized&&{...a.realized,actual:a.realized.time}].filter(Boolean);
      for(const e of events){
        const planned=Number(e.baseline||a.planning?.time||a.original?.time),at=Number(e.recordedAt||e.sourceTimestamp);
        if(!accepted.includes(e.source)||!Number.isFinite(planned)||planned<=0||!Number.isFinite(at)||at<=0)continue;
        const actual=Number(e.actual)||null,expected=Number(e.expected)||null;
        if(!e.cancelled&&!actual&&!expected)continue;
        const date=day(planned);if(date<selection.from||date>selection.to)continue;
        const event={date,number:String(state.trainNumber),category:state.category,source:e.source,station:stop.station,mode:'arrival',planned,observedAt:at,actual,expected,cancelled:!!e.cancelled,realtime:true,delay:actual||expected?Math.round(((actual||expected)-planned)/60000):null};
        rows.push({event_date:date,train_number:event.number,category:event.category,station:normalizeStation(stop.station),source:e.source,event_mode:'arrival',last_seen:at,measured_at:at,payload:JSON.stringify(event),measured_payload:JSON.stringify(event)});
      }
    }
  }return rows;
}

// Prefer a usable arrival; a departure fallback remains explicitly identified.
export function buildTrainReport(selection,rows) {
  const {group,station,dates}=selection,primary=new Set(aliasesFor(station)),fallback=group.id==='berlin-east'&&station==='Berlin Hbf'?new Set(aliasesFor('Berlin Gesundbrunnen')):new Set();
  const sources=selection.source==='NDOV'?['NDOV','NDOV_RIT']:['DB'];
  const candidates=new Map(),aliases=numberAliases(group);
  for(const row of rows){
    if(!sources.includes(row.source)||!['arrival','departure'].includes(row.event_mode)||!dates.includes(row.event_date)||!['ICE','NJ','IC','EC'].includes(String(row.category).toUpperCase()))continue;
    const isPrimary=primary.has(row.station);
    if(!isPrimary&&!fallback.has(row.station))continue;
    let latest,measured;
    try{latest=JSON.parse(row.payload);measured=row.measured_payload?JSON.parse(row.measured_payload):null;}catch{continue;}
    if(!Number.isFinite(latest.planned)||day(latest.planned)!==row.event_date)continue;
    // Only a realtime value for this exact planned stop may supply the delay.
    if(measured&&(measured.planned!==latest.planned||measured.number!==latest.number||measured.mode!==row.event_mode))measured=null;
    const usable=!!latest.cancelled||!!(measured?.realtime&&!measured.cancelled&&Number.isFinite(measured.delay));
    const key=row.event_date+'|'+(aliases[row.train_number]||row.train_number);
    const candidate={row,latest,measured,rank:(usable?10:0)+(row.event_mode==='arrival'?2:0)+(isPrimary?1:0)};
    const old=candidates.get(key);
    if(!old||candidate.rank>old.rank||candidate.rank===old.rank&&Number(row.last_seen)>Number(old.row.last_seen))candidates.set(key,candidate);
  }
  return {...Object.fromEntries(['station','source','days','from','to'].map(k=>[k,selection[k]])),group:group.id,rows:dates.map(date=>({date,cells:reportNumbers(group,date).map(number=>{
    const chosen=candidates.get(date+'|'+number);
    if(!chosen)return {number,status:'unknown'};
    const {row,latest,measured}=chosen;
    const common={number,eventMode:row.event_mode,station:latest.station,source:row.source,observedAt:Number(row.last_seen),planned:latest.planned};
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
  const rows=await q(`SELECT event_date,source,train_number,category,station,event_mode,last_seen,measured_at,measured_payload,payload FROM train_stop_summaries WHERE event_date >= $1 AND event_date <= $2 AND event_mode IN ('arrival','departure') AND train_number IN (${numberSQL}) AND station IN (${stationSQL}) AND source IN (${sourceSQL})`,args);
  const journeyArgs=[shift(selection.from,-2),selection.to,...numbers];
  const journeys=await q(`SELECT state_json FROM journey_archive WHERE service_date >= $1 AND service_date <= $2 AND train_number IN (${numbers.map((_,i)=>'$'+(i+3)).join(',')})`,journeyArgs);
  return buildTrainReport(selection,[...rows,...journeyReportRows(journeys,selection)]);
}
