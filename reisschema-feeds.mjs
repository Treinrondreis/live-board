import {unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {norm} from './reisschema-control.mjs';

export function* csv(text){
 let values=[],value='',quoted=false,header;
 for(let i=0;i<=text.length;i++){
  const c=text[i]??'\n';
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c===','||c==='\n')){values.push(value.replace(/\r$/,''));value='';if(c==='\n'){if(!header)header=values.map(x=>x.replace(/^\uFEFF/,''));else if(values.length===header.length)yield Object.fromEntries(header.map((h,j)=>[h,values[j]]));values=[];}}
  else value+=c;
 }
}
export function gtfsClock(day,value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(value||''))return null;
 const [h,m]=value.split(':').map(Number);return {date:new Date(Date.parse(day)+Math.floor(h/24)*86400000).toISOString().slice(0,10),time:String(h%24).padStart(2,'0')+':'+String(m).padStart(2,'0')};
}
const iso=s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
const label=s=>String(s||'').replace(/\s/g,'').toUpperCase();
const railKind=s=>label(s).replace(/\d+[a-z]?$/i,'').replace(/^TGVINOUI$/,'TGV').replace(/^INTERCITES$/,'IC');
const frenchKind=id=>{const kind=String(id).match(/^StopPoint:OCE(.+)-\d+$/)?.[1]||'';return kind.startsWith('TGV')?'TGV':kind.startsWith('INTERCITES')?'IC':kind==='Train TER'?'TER':kind==='Lyria'?'TGVLYRIA':label(kind);};
const fields=o=>({departure_date:o.departure.date,departure_time:o.departure.time,arrival_date:o.arrival.date,arrival_time:o.arrival.time,cancelled:false,connection_broken:false,backup_communicated:false});
function matchStops(stops,leg,serviceDate){
 const starts=stops.filter(s=>norm(s.name)===norm(leg.from_station)&&s.pickup!=='1'),ends=stops.filter(s=>norm(s.name)===norm(leg.to_station)&&s.dropoff!=='1');
 if(starts.length!==1||ends.length!==1||starts[0].sequence>=ends[0].sequence)return null;
 const departure=gtfsClock(serviceDate,starts[0].departure),arrival=gtfsClock(serviceDate,ends[0].arrival);
 return departure&&arrival&&departure.date===leg.travel_date?{...fields({departure,arrival}),from_country:starts[0].country,to_country:ends[0].country}:null;
}
export function parseGtfs(bytes,legs,meta){
 const files=unzipSync(bytes,{filter:f=>['feed_info.txt','stops.txt','routes.txt','trips.txt','calendar.txt','calendar_dates.txt','stop_times.txt'].includes(f.name)&&f.originalSize<100*1024*1024});
 if(['stops.txt','routes.txt','trips.txt','stop_times.txt'].some(f=>!files[f]))throw Error('Onvolledige of te grote GTFS');
 const read=f=>csv(files[f]?strFromU8(files[f]):'');
 const info=[...read('feed_info.txt')][0]||{},version=info.feed_version||meta.hash;
 const stops=new Map([...read('stops.txt')].map(s=>[s.stop_id,s]));
 const routes=new Map([...read('routes.txt')].map(s=>[s.route_id,s]));
 const calendar=new Map([...read('calendar.txt')].map(s=>[s.service_id,s]));
 const exceptions=new Map([...read('calendar_dates.txt')].map(s=>[s.service_id+'|'+s.date,s.exception_type]));
 const numbers=new Set(legs.map(l=>label(l.train_number))),numericNumbers=new Set(legs.map(l=>l.train_number.match(/\d+$/)?.[0])),dates=new Set();
 for(const leg of legs)for(let offset=-2;offset<=0;offset++)dates.add(new Date(Date.parse(leg.travel_date)+offset*86400000).toISOString().slice(0,10));
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 const trips=new Map();
 for(const trip of read('trips.txt')){
  const route=routes.get(trip.route_id)||{},sncf=meta.name==='SNCF GTFS',name=label(trip.trip_short_name||(sncf&&/^\d+$/.test(trip.trip_headsign)?trip.trip_headsign:'')),category=label(route.route_short_name).replace(/\d+$/,'');
  if(route.route_type&&Number(route.route_type)!==2&&!(Number(route.route_type)>=100&&Number(route.route_type)<200))continue;
  if(!numbers.has(name)&&!numbers.has(category+name)&&!(sncf&&numericNumbers.has(name))&&!(name===''&&category==='RJ'))continue;
  const days=[...dates].filter(day=>{const d=day.replaceAll('-',''),exception=exceptions.get(trip.service_id+'|'+d),c=calendar.get(trip.service_id);return exception?exception==='1':c&&d>=c.start_date&&d<=c.end_date&&c[weekdays[new Date(day).getUTCDay()]]==='1';});
  if(days.length)trips.set(trip.trip_id,{...trip,name,category,days,stops:[]});
 }
 for(const s of read('stop_times.txt')){const t=trips.get(s.trip_id),stop=stops.get(s.stop_id);if(t&&stop)t.stops.push({name:stop.stop_name,sequence:+s.stop_sequence,departure:s.departure_time,arrival:s.arrival_time,pickup:s.pickup_type,dropoff:s.drop_off_type,category:meta.name==='SNCF GTFS'?frenchKind(s.stop_id):t.category});}
 for(const t of trips.values())t.stops.sort((a,b)=>a.sequence-b.sequence);
 return Object.fromEntries(legs.map(leg=>{
  const candidates=[];let overflow=false;
  for(const t of trips.values()){
   const exact=numbers.has(t.name)&&t.name===label(leg.train_number)||t.category+t.name===label(leg.train_number)||meta.name==='SNCF GTFS'&&t.name===leg.train_number.match(/\d+$/)?.[0]&&t.stops.some(s=>norm(s.name)===norm(leg.from_station)&&s.category&&s.category===railKind(leg.train_number));
   const unnumbered=t.name===''&&t.category==='RJ'&&/^RJ\s*\d/i.test(leg.train_number);
   if(!exact&&!unnumbered)continue;
   for(const serviceDate of t.days){
    const paths=[{stops:t.stops,ids:[t.trip_id]}];
    // Only join equal explicit train numbers at the same shared boundary station.
    // A missing middle section or an unnumbered RJ is never filled with guessed calls.
    if(exact)for(let i=0;i<paths.length&&paths.length<50;i++){
     const path=paths[i],end=path.stops.at(-1);if(!end||path.ids.length>=4||matchStops(path.stops,leg,serviceDate)||!path.stops.some(s=>norm(s.name)===norm(leg.from_station)))continue;
     for(const next of trips.values()){
      if(next.name!==t.name||next.category!==t.category||path.ids.includes(next.trip_id)||!next.days.includes(serviceDate))continue;
      const start=next.stops[0];if(!start||norm(start.name)!==norm(end.name))continue;
      const a=gtfsClock(serviceDate,end.arrival),d=gtfsClock(serviceDate,start.departure);
      if(!a||!d||a.date+'T'+a.time>d.date+'T'+d.time)continue;
      const merged=[...path.stops.slice(0,-1),{...end,departure:start.departure},...next.stops.slice(1)].map((s,j)=>({...s,sequence:j+1}));
      if(paths.length>=50){overflow=true;break;}
      paths.push({stops:merged,ids:[...path.ids,next.trip_id]});
     }
    }
    for(const path of paths){const o=matchStops(path.stops,leg,serviceDate);if(!o)continue;
    // An unnumbered RJ needs the exact full registered endpoint pair and a compatible destination.
    if(unnumbered&&norm(t.trip_headsign)!==norm(leg.to_station))continue;
    const {from_country,to_country,...times}=o;
    candidates.push({observation:{...times,source:meta.name,observed_at:meta.modified||meta.loadedAt},evidence:{feed_version:version,service_date:serviceDate,trip_id:t.trip_id,trip_ids:path.ids,number_missing:unnumbered}});
    }
   }
  }
  return [leg.leg_id,candidates.length===1&&!overflow?{...candidates[0],sources:[JSON.stringify({source:meta.name,feed_version:version,downloaded_at:meta.loadedAt,source_modified:meta.modified,...candidates[0].evidence})]}:{reason:candidates.length||overflow?'Meerdere passende ritten; controleer DB':'Geen volledig en eenduidig passend ritdeel; niet automatisch opgeheven',sources:[JSON.stringify({source:meta.name,feed_version:version,downloaded_at:meta.loadedAt})]}];
 }));
}
export function parseIff(bytes,legs,meta){
 const files=unzipSync(bytes,{filter:f=>['delivery.dat','footnote.dat','stations.dat','timetbls.dat'].includes(f.name)&&f.originalSize<100*1024*1024});
 const read=name=>{if(!files[name])throw Error('IFF ontbreekt');return new TextDecoder('windows-1252').decode(files[name]);};
 const delivery=read('delivery.dat').trim().split(','),date=s=>s.slice(4,8)+'-'+s.slice(2,4)+'-'+s.slice(0,2),start=date(delivery[1]),end=date(delivery[2]);
 const notes=new Map(read('footnote.dat').split('#').slice(1).map(b=>{const l=b.split(/[\r\n]+/).filter(Boolean);return [l[0].trim(),l.slice(1).join('').trim()];}));
 const stations=new Map(read('stations.dat').split(/[\r\n]+/).filter(l=>l&&!l.startsWith('@')).map(l=>{const f=l.split(',');return [f[1].trim().toUpperCase(),{name:f.at(-1).trim(),country:f[4]?.trim()}];}));
 const results=new Map(legs.map(l=>[l.leg_id,[]]));
 for(const block of read('timetbls.dat').split('#').slice(1)){
  const lines=block.split(/[\r\n]+/).filter(Boolean),records=p=>lines.filter(l=>l[0]===p).map(l=>l.slice(1).split(',').map(s=>s.trim()));
  const services=records('%'),running=records('-'),categories=records('&'),attributes=records('*');
  const selected=legs.filter(l=>services.some(s=>String(Number(s[1]))===l.train_number.match(/\d+$/)?.[0]));if(!selected.length)continue;
  for(const leg of selected)for(let offset=-2;offset<=0;offset++){
   const serviceDate=new Date(Date.parse(leg.travel_date)+offset*86400000).toISOString().slice(0,10);if(serviceDate<start||serviceDate>end)continue;
   const index=Math.round((Date.parse(serviceDate)-Date.parse(start))/86400000),active=n=>notes.get(n)?.[index]==='1';
   if(!running.some(r=>active(r[0])))continue;
   let last=-1,extra=0;const stops=[];
   const time=s=>{let m=Number(s.slice(0,2))*60+Number(s.slice(2));if(m<last)extra+=1440;last=m;m+=extra;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')+':00';};
   for(const line of lines)if(['>','+','.','<'].includes(line[0])){
    const [code,...times]=line.slice(1).split(',').map(s=>s.trim()),station=stations.get(code.toUpperCase());
    const arrival=line[0]==='>'?null:time(times[0]),departure=line[0]==='<'?null:line[0]==='.'?arrival:time(times.at(-1));
    stops.push({name:station?.name||code,country:station?.country,arrival,departure,sequence:stops.length+1});
   }
   for(const stop of stops){
    if(attributes.some(a=>a[0]==='NIIN'&&stop.sequence>=+a[1]&&stop.sequence<=+a[2]&&active(a[3])))stop.pickup='1';
    if(attributes.some(a=>a[0]==='NUIT'&&stop.sequence>=+a[1]&&stop.sequence<=+a[2]&&active(a[3])))stop.dropoff='1';
   }
   const o=matchStops(stops,leg,serviceDate);if(!o)continue;
   const from=stops.find(s=>norm(s.name)===norm(leg.from_station)),to=stops.find(s=>norm(s.name)===norm(leg.to_station));
   const cat=label(leg.train_number.match(/^[a-z]+/i)?.[0]);
   if(!services.some(s=>String(Number(s[1]))===leg.train_number.match(/\d+$/)?.[0]&&from.sequence>=+s[3]&&to.sequence<=+s[4]))continue;
   if(!categories.some(c=>label(c[0])===cat&&from.sequence>=+c[1]&&to.sequence<=+c[2]))continue;
   if(!running.some(r=>active(r[0])&&from.sequence>=+r[1]&&to.sequence<=+r[2]))continue;
   // ICE/NJ: NDOV is only evidence for endpoints inside the Netherlands.
   if(['ICE','NJ'].includes(cat)&&[from,to].some(s=>!['NL','1'].includes(s.country)))continue;
   const {from_country,to_country,...observation}=o;
   results.get(leg.leg_id).push({observation:{...observation,source:'NDOV IFF',observed_at:meta.modified||meta.loadedAt},sources:[JSON.stringify({source:'NDOV IFF',feed_version:meta.hash,service_date:serviceDate,trip_id:lines[0],valid_from:start,valid_until:end,downloaded_at:meta.loadedAt,source_modified:meta.modified})]});
  }
 }
 return Object.fromEntries(legs.map(l=>{const found=results.get(l.leg_id);return [l.leg_id,found.length===1?found[0]:{reason:found.length?'Meerdere IFF-ritten; controleer DB':'Geen volledige IFF-dekking voor deze rit en datum',sources:[JSON.stringify({source:'NDOV IFF',feed_version:meta.hash,valid_from:start,valid_until:end,downloaded_at:meta.loadedAt})]}];}));
}
async function download(url,headers,fetcher,now){
 const response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Bron niet bereikbaar');
 const modified=Date.parse(response.headers.get('last-modified'));
 if(!Number.isFinite(modified)||now-modified>8*86400000||modified>now+300000)throw Error('Bronversheid niet bevestigd');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>30*1024*1024)throw Error('Bestand te groot');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return {bytes:new Uint8Array(Buffer.concat(parts)),modified:new Date(modified).toISOString()};
}
export function createPlanningSources({env=process.env,fetcher=fetch,clock=Date.now}={}){
 const enabled=()=>env.REISSCHEMA_PATRICK_ENABLED==='1';
 return {
  async prepare(legs,heartbeat=async()=>{}){
   const outputs=[];
   const feeds=[{kind:'iff',name:'NDOV IFF',url:'https://data.ndovloket.nl/ns/ns-latest.zip'},
    ...(enabled()?[{kind:'gtfs',name:'GTFS.de',url:'https://download.gtfs.de/treinrondreis/latest.zip',headers:{Authorization:'Basic '+Buffer.from((env.REISSCHEMA_PATRICK_USER||'')+':'+(env.REISSCHEMA_PATRICK_PASSWORD||'')).toString('base64')}}]:[]),
    ...(env.REISSCHEMA_SNCF_ENABLED==='1'?[{kind:'gtfs',name:'SNCF GTFS',url:'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip'}]:[]),
    ...(env.REISSCHEMA_NMBS_ENABLED==='1'&&env.BMC_PARTNER_KEY?[{kind:'gtfs',name:'NMBS GTFS',url:'https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/static',headers:{'bmc-partner-key':env.BMC_PARTNER_KEY}}]:[])];
   for(const source of feeds){
    await heartbeat();
    try{const {bytes,modified}=await download(source.url,source.headers||{},fetcher,clock()),meta={name:source.name,hash:createHash('sha256').update(bytes).digest('hex'),loadedAt:new Date(clock()).toISOString(),modified};
     const rows=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:{kind:source.kind,bytes,legs,meta},transferList:[bytes.buffer],resourceLimits:{maxOldGenerationSizeMb:256}});const timer=setTimeout(()=>{void worker.terminate();reject(Error('Verwerking verlopen'));},120000);worker.once('message',resolve);worker.once('error',()=>reject(Error('Verwerking mislukt')));worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Verwerking gestopt'));});});outputs.push(rows);
    }catch{outputs.push(Object.fromEntries(legs.map(l=>[l.leg_id,{reason:source.name+' niet bereikbaar',sources:[]}])));}
   }
   return {async lookup(leg){
    const matches=outputs.map(o=>o[leg.leg_id]).filter(r=>r?.observation);
    // Conflicting sources are never silently prioritized.
    if(matches.length>1&&new Set(matches.map(r=>JSON.stringify(fields({departure:{date:r.observation.departure_date,time:r.observation.departure_time},arrival:{date:r.observation.arrival_date,time:r.observation.arrival_time}})))).size>1)return {reason:'Bronnen spreken elkaar tegen; controleer DB',sources:matches.flatMap(m=>m.sources)};
    const result=matches[0];
    if(result&&Date.parse(result.observation.observed_at)<Date.parse(leg.observation?.observed_at))return {reason:'Bron ouder dan de laatst vastgelegde controle; handmatig beoordelen',sources:result.sources};
    if(result&&(!leg.departure_time||!leg.arrival_time))return {reason:'Oorspronkelijke tijden ontbreken; eerst reisschema controleren',sources:result.sources};
    return result||{reason:outputs.map(o=>o[leg.leg_id]?.reason).filter(Boolean).join('; ')||'Geen bruikbare bron; controleer DB',sources:outputs.flatMap(o=>o[leg.leg_id]?.sources||[])};
   }};
  }};
}
if(!isMainThread&&workerData?.kind)parentPort.postMessage((workerData.kind==='iff'?parseIff:parseGtfs)(workerData.bytes,workerData.legs,workerData.meta));
