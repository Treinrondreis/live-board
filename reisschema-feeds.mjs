import {unzipSync,strFromU8,Unzip,UnzipInflate} from 'fflate';
import {createHash} from 'node:crypto';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {norm} from './reisschema-control.mjs';
import {createIrailSource} from './reisschema-irail.mjs';
import {applyNumberPolicy,trainDigits,trainKind,numberAssessment} from './reisschema-number-policy.mjs';

export function* csv(text){
 let values=[],value='',quoted=false,header;
 for(let i=0;i<=text.length;i++){
  const c=text[i]??'\n';
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(c===','||c==='\n')){values.push(value.replace(/\r$/,''));value='';if(c==='\n'){if(!header)header=values.map(x=>x.replace(/^\uFEFF/,''));else if(values.length===header.length)yield Object.fromEntries(header.map((h,j)=>[h,values[j]]));values=[];}}
  else value+=c;
 }
}
// Large calendars and stop times are consumed incrementally, never retained in full.
export function visitZipCsv(bytes,name,consume,{limit=512*1024*1024,chunkSize=65536}={}){
 let found=false,finished=false,size=0,record='',quoted=false,pendingQuote=false;
 let header;const decoder=new TextDecoder();
 const emit=()=>{if(record.length){const rows=[...csv((header?header+'\n':'')+record+'\n')];if(!header)header=record.replace(/^\uFEFF/,'');else if(rows.length===1)consume(rows[0]);else throw Error('Ongeldige CSV-regel');}record='';};
 const push=text=>{for(const ch of text){
  if(pendingQuote){pendingQuote=false;if(ch==='"'){record+=ch;continue;}quoted=false;}
  if(ch==='"'){record+=ch;if(quoted)pendingQuote=true;else quoted=true;}
  else if(ch==='\n'&&!quoted)emit();else record+=ch;
  if(record.length>65536)throw Error('CSV-regel te groot');
 }};
 const zip=new Unzip(file=>{if(file.name!==name)return;if(found)throw Error('Dubbel GTFS-bestand');found=true;
  if(file.originalSize>limit)throw Error('GTFS-bestand te groot');
  file.ondata=(error,data,final)=>{if(error)throw error;size+=data.length;if(size>limit)throw Error('GTFS-bestand te groot');push(decoder.decode(data,{stream:!final}));if(final){if(quoted&&!pendingQuote)throw Error('Onvolledige CSV');emit();finished=true;}};file.start();
 });zip.register(UnzipInflate);
 for(let i=0;i<bytes.length;i+=chunkSize)zip.push(bytes.subarray(i,i+chunkSize),i+chunkSize>=bytes.length);
 if(!found||!finished)throw Error('GTFS-bestand ontbreekt');
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
 const named=(s,name)=>[s.name,...(s.aliases||[])].some(n=>norm(n)===norm(name));
 const starts=stops.filter(s=>named(s,leg.from_station)&&s.pickup!=='1'),ends=stops.filter(s=>named(s,leg.to_station)&&s.dropoff!=='1');
 if(starts.length!==1||ends.length!==1||starts[0].sequence>=ends[0].sequence)return null;
 const departure=gtfsClock(serviceDate,starts[0].departure),arrival=gtfsClock(serviceDate,ends[0].arrival);
 return departure&&arrival&&departure.date===leg.travel_date?{...fields({departure,arrival}),from_country:starts[0].country,to_country:ends[0].country}:null;
}
export function parseGtfs(bytes,legs,meta){
 const files=unzipSync(bytes,{filter:f=>['feed_info.txt','stops.txt','routes.txt','trips.txt','calendar.txt','translations.txt'].includes(f.name)&&f.originalSize<100*1024*1024});
 if(['stops.txt','routes.txt','trips.txt'].some(f=>!files[f]))throw Error('Onvolledige of te grote GTFS');
 const read=f=>csv(files[f]?strFromU8(files[f]):'');
 const info=[...read('feed_info.txt')][0]||{},version=info.feed_version||meta.hash;
 const stops=new Map([...read('stops.txt')].map(s=>[s.stop_id,s]));
 const translations=new Map();
 if(meta.name==='NMBS GTFS')for(const t of read('translations.txt'))if(t.table_name==='stops'&&t.field_name==='stop_name'&&t.translation){const key=t.record_id||t.field_value;translations.set(key,[...(translations.get(key)||[]),t.translation]);}
 const aliases=stop=>meta.name==='NMBS GTFS'?[stop.stop_name,...(translations.get(stop.stop_id)||[]),...(translations.get(stop.stop_name)||[])].flatMap(n=>[n,n.replace(/ \([A-Z]{2}\)$/,'')]):[];
 const routes=new Map([...read('routes.txt')].map(s=>[s.route_id,s]));
 const calendar=new Map([...read('calendar.txt')].map(s=>[s.service_id,s]));
 const numbers=new Set(legs.map(l=>label(l.train_number))),numericNumbers=new Set(legs.map(l=>l.train_number.match(/\d+$/)?.[0])),dates=new Set();
 for(const leg of legs)for(let offset=-2;offset<=0;offset++)dates.add(new Date(Date.parse(leg.travel_date)+offset*86400000).toISOString().slice(0,10));
 const exceptions=new Map(),wantedDates=new Set([...dates].map(d=>d.replaceAll('-','')));
 // calendar_dates is optional when calendar supplies the service calendar.
 let hasExceptions=false;unzipSync(bytes,{filter:f=>{if(f.name==='calendar_dates.txt')hasExceptions=true;return false;}});
 if(hasExceptions)visitZipCsv(bytes,'calendar_dates.txt',s=>{if(wantedDates.has(s.date))exceptions.set(s.service_id+'|'+s.date,s.exception_type);});
 else if(!files['calendar.txt'])throw Error('GTFS-rijdagen ontbreken');
 const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
 const trips=new Map(),endpointNames=new Set(legs.flatMap(l=>[norm(l.from_station),norm(l.to_station)]));let alternateCount=0,alternateLimit=false;
 for(const trip of read('trips.txt')){
  const route=routes.get(trip.route_id)||{},sncf=meta.name==='SNCF GTFS',name=label(trip.trip_short_name||(sncf&&/^\d+$/.test(trip.trip_headsign)?trip.trip_headsign:'')),category=label(route.route_short_name).replace(/\d+$/,'');
  if(route.route_type&&Number(route.route_type)!==2&&!(Number(route.route_type)>=100&&Number(route.route_type)<200))continue;
  const exactForAny=numericNumbers.has(trainDigits(name));
  if(!exactForAny&&alternateCount>=20000){alternateLimit=true;continue;}
  const days=[...dates].filter(day=>{const d=day.replaceAll('-',''),exception=exceptions.get(trip.service_id+'|'+d),c=calendar.get(trip.service_id);return exception?exception==='1':c&&d>=c.start_date&&d<=c.end_date&&c[weekdays[new Date(day).getUTCDay()]]==='1';});
  if(days.length){if(!exactForAny)alternateCount++;trips.set(trip.trip_id,{...trip,name,category,days,alternativeOnly:!exactForAny,stops:[]});}
 }
 visitZipCsv(bytes,'stop_times.txt',s=>{const t=trips.get(s.trip_id),stop=stops.get(s.stop_id);if(t&&stop){const otherNames=aliases(stop);if(t.alternativeOnly&&![stop.stop_name,...otherNames].some(n=>endpointNames.has(norm(n))))return;t.stops.push({name:stop.stop_name,aliases:otherNames,sequence:+s.stop_sequence,departure:s.departure_time,arrival:s.arrival_time,pickup:s.pickup_type,dropoff:s.drop_off_type,category:meta.name==='SNCF GTFS'?frenchKind(s.stop_id):t.category});}});
 for(const t of trips.values())t.stops.sort((a,b)=>a.sequence-b.sequence);
 return Object.fromEntries(legs.map(leg=>{
  const candidates=[];let overflow=false;
  for(const t of trips.values()){
   const exact=!!trainDigits(t.name)&&trainDigits(t.name)===trainDigits(leg.train_number);
   const unnumbered=t.name===''&&(t.category==='RJ'&&trainKind(leg.train_number)==='RJ'||trainKind(leg.train_number).startsWith('TGV')&&t.stops.some(s=>s.category?.startsWith('TGV')));
   if(!exact&&!unnumbered&&!t.name)continue;
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
    if(!exact&&(o.departure_time!==leg.departure_time||o.arrival_time!==leg.arrival_time||o.arrival_date!==(leg.arrival_date||leg.travel_date)))continue;
    // An unnumbered RJ needs the exact full registered endpoint pair and a compatible destination.
    if(unnumbered&&trainKind(leg.train_number)==='RJ'&&norm(t.trip_headsign)!==norm(leg.to_station))continue;
    const {from_country,to_country,...times}=o;
    const currentNumber=/[A-Z]/.test(t.name)?t.name:t.name?(t.stops[0]?.category||t.category)+' '+t.name:'';
    candidates.push({exact,observation:{...times,train_number:currentNumber,source:meta.name,observed_at:meta.modified||meta.loadedAt},evidence:{feed_version:version,service_date:serviceDate,trip_id:t.trip_id,trip_ids:path.ids,number_missing:unnumbered,number_replaced:!exact}});
    }
   }
  }
  const found=candidates.some(c=>c.exact)?candidates.filter(c=>c.exact):candidates;
  const limited=alternateLimit&&!found.some(c=>c.exact);
  return [leg.leg_id,found.length===1&&!overflow&&!limited?{...found[0],sources:[JSON.stringify({source:meta.name,feed_version:version,downloaded_at:meta.loadedAt,source_modified:meta.modified,...found[0].evidence})]}:{reason:found.length||overflow||limited?'Meerdere passende ritten of zoekgrens bereikt; controleer DB':'Geen volledig en eenduidig passend ritdeel; niet automatisch opgeheven',sources:[JSON.stringify({source:meta.name,feed_version:version,downloaded_at:meta.loadedAt})]}];
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
  const served=new Set(lines.filter(l=>['>','+','.','<'].includes(l[0])).map(l=>norm(stations.get(l.slice(1).split(',')[0].trim().toUpperCase())?.name)));
  const selected=legs.filter(l=>services.some(s=>String(Number(s[1]))===trainDigits(l.train_number))||served.has(norm(l.from_station))&&served.has(norm(l.to_station)));if(!selected.length)continue;
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
   const exact=services.some(s=>String(Number(s[1]))===trainDigits(leg.train_number));
   // A renumbering inside one explicit IFF journey is a source-proven through service.
   // An unrelated number needs the original full endpoint/date/time pair and uniqueness.
   if(!exact&&(o.departure_time!==leg.departure_time||o.arrival_time!==leg.arrival_time||o.arrival_date!==(leg.arrival_date||leg.travel_date)))continue;
   let covered=from.sequence;const segments=services.filter(s=>+s[4]>from.sequence&&+s[3]<to.sequence).sort((a,b)=>+a[3]-+b[3]);
   for(const s of segments)if(+s[3]<=covered)covered=Math.max(covered,+s[4]);
   if(covered<to.sequence)continue;
   const category=categories.find(c=>from.sequence>=+c[1]&&from.sequence<+c[2]&&!['BUS','FERRY'].includes(label(c[0])));
   if(!category)continue;
   if(!running.some(r=>active(r[0])&&from.sequence>=+r[1]&&to.sequence<=+r[2]))continue;
   // International Nightjets are accepted when the complete dated endpoint pair is present.
   // An additional explicit DB verification remains visible through applyNumberPolicy.
   if(trainKind(leg.train_number)==='ICE'&&[from,to].some(s=>!['NL','1'].includes(s.country)))continue;
   const boarding=segments.find(s=>+s[3]<=from.sequence&&+s[4]>from.sequence);
   const currentNumber=label(category[0])+' '+String(Number(boarding?.[1]||services[0]?.[1]));
   const {from_country,to_country,...observation}=o;
   results.get(leg.leg_id).push({exact,observation:{...observation,train_number:currentNumber,source:'NDOV IFF',observed_at:meta.modified||meta.loadedAt},sources:[JSON.stringify({source:'NDOV IFF',feed_version:meta.hash,service_date:serviceDate,trip_id:lines[0],route_train_numbers:[...new Set(segments.map(s=>String(Number(s[1]))))],valid_from:start,valid_until:end,downloaded_at:meta.loadedAt,source_modified:meta.modified})]});
  }
 }
 return Object.fromEntries(legs.map(l=>{const all=results.get(l.leg_id),found=all.some(r=>r.exact)?all.filter(r=>r.exact):all;return [l.leg_id,found.length===1?found[0]:{reason:found.length?'Meerdere IFF-ritten; controleer DB':'Geen volledige IFF-dekking voor deze rit en datum',sources:[JSON.stringify({source:'NDOV IFF',feed_version:meta.hash,valid_from:start,valid_until:end,downloaded_at:meta.loadedAt})]}];}));
}
async function download(url,headers,fetcher,now){
 const response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Bron niet bereikbaar');
 const modified=Date.parse(response.headers.get('last-modified'));
 if(!Number.isFinite(modified)||now-modified>8*86400000||modified>now+300000)throw Error('Bronversheid niet bevestigd');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>30*1024*1024)throw Error('Bestand te groot');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return {bytes:new Uint8Array(Buffer.concat(parts)),modified:new Date(modified).toISOString()};
}
export const sourceCheckFresh=(result,now)=>{
 const evidence=(result.sources||[]).map(s=>{try{return JSON.parse(s);}catch{return {};}});
 return evidence.length>0&&evidence.every(s=>Number.isFinite(Date.parse(s.downloaded_at))&&now-Date.parse(s.downloaded_at)<=4*3600000&&Date.parse(s.downloaded_at)<=now+60000);
};
export function reconcilePlanningSources(matches,now){
 if(!matches.length)return null;
 const evidence=matches.flatMap(m=>(m.sources||[]).map(s=>{try{return JSON.stringify({...JSON.parse(s),compared_departure_date:m.observation.departure_date,compared_departure_time:m.observation.departure_time,compared_arrival_date:m.observation.arrival_date,compared_arrival_time:m.observation.arrival_time});}catch{return s;}}));
 if(matches.length>1){
  const clocks=['departure','arrival'].map(mode=>matches.map(m=>Date.parse(m.observation[mode+'_date']+'T'+m.observation[mode+'_time']+':00Z')/60000));
  const conflict=clocks.some(times=>times.some(t=>!Number.isFinite(t))||Math.max(...times)-Math.min(...times)>=3)||new Set(matches.map(m=>!!m.observation.cancelled)).size>1;
  if(matches.some(m=>!sourceCheckFresh(m,now)))return {sourceConflict:true,reason:'Bronvergelijking nog niet bevestigd: raadpleging maximaal 4 uur oud vereist; handmatig controleren',sources:evidence};
  if(conflict)return {sourceConflict:true,reason:'Bronnen spreken elkaar tegen (minimaal 3 minuten of andere uitvalstatus); binnen 4 uur geraadpleegd; '+matches.map(m=>m.observation.source+': '+m.observation.departure_time+' → '+m.observation.arrival_time+(m.observation.cancelled?' (uitval)':'')).join('; ')+'; handmatig controleren',sources:evidence};
 }
 // Keep the stable source order; never average times or discard supporting evidence.
 return {...matches[0],sources:evidence,reason:matches.length>1?'Bronnen vergeleken; maximaal 2 minuten verschil geaccepteerd':''};
}
export function createPlanningSources({env=process.env,fetcher=fetch,clock=Date.now}={}){
 const enabled=()=>env.REISSCHEMA_PATRICK_ENABLED==='1';
 return {
  async prepare(legs,heartbeat=async()=>{}){
   const outputs=[],statuses=[],refreshed=new Set();
   const irail=createIrailSource({fetcher,clock});
   const feeds=[{kind:'iff',name:'NDOV IFF',url:'https://data.ndovloket.nl/ns/ns-latest.zip'},
    ...(enabled()?[{kind:'gtfs',name:'GTFS.de',url:'https://download.gtfs.de/treinrondreis/latest.zip',headers:{Authorization:'Basic '+Buffer.from((env.REISSCHEMA_PATRICK_USER||'')+':'+(env.REISSCHEMA_PATRICK_PASSWORD||'')).toString('base64')}}]:[]),
    ...(env.REISSCHEMA_SNCF_ENABLED==='1'?[{kind:'gtfs',name:'SNCF GTFS',url:'https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip'}]:[]),
    ...(env.REISSCHEMA_IRAIL_ENABLED==='1'?[{kind:'irail',name:'iRail'}]:[]),
    ...(env.REISSCHEMA_NMBS_ENABLED==='1'&&env.BMC_PARTNER_KEY?[{kind:'gtfs',name:'NMBS GTFS',fallback:true,url:'https://api-management-opendata-production.azure-api.net/api/gtfs/feed/nmbssncb/static',headers:{'bmc-partner-key':env.BMC_PARTNER_KEY}}]:[])];
   const load=async(source,rowsToCheck)=>{
    await heartbeat();
    if(source.kind==='irail'){
     const rows={};for(const leg of rowsToCheck)rows[leg.leg_id]=await irail.lookup(leg,heartbeat);
     return {rows,status:{name:source.name,status:Object.values(rows).some(r=>r.observation)?'ready':'unavailable',matched:Object.values(rows).filter(r=>r.observation).length}};
    }
    try{const {bytes,modified}=await download(source.url,source.headers||{},fetcher,clock()),meta={name:source.name,hash:createHash('sha256').update(bytes).digest('hex'),loadedAt:new Date(clock()).toISOString(),modified};
     const rows=await new Promise((resolve,reject)=>{const worker=new Worker(new URL(import.meta.url),{workerData:{kind:source.kind,bytes,legs:rowsToCheck,meta},transferList:[bytes.buffer],resourceLimits:{maxOldGenerationSizeMb:256}});const timer=setTimeout(()=>{void worker.terminate();reject(Error('Verwerking verlopen'));},120000);worker.once('message',resolve);worker.once('error',()=>reject(Error('Verwerking mislukt')));worker.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Verwerking gestopt'));});});
     return {rows,status:{name:source.name,status:'ready',modified,matched:Object.values(rows).filter(r=>r.observation).length}};
    }catch{return {rows:Object.fromEntries(rowsToCheck.map(l=>[l.leg_id,{reason:source.name+' niet bereikbaar of niet bruikbaar',sources:[]}])),status:{name:source.name,status:'unavailable',matched:0}};}
   };
   for(const source of feeds){
    const irailIndex=feeds.findIndex(f=>f.kind==='irail');
    const selected=source.fallback&&irailIndex>=0?legs.filter(l=>!outputs[irailIndex]?.[l.leg_id]?.observation):legs;
    const loaded=selected.length?await load(source,selected):{rows:{},status:{name:source.name,status:'not_needed',matched:0}};
    outputs.push(loaded.rows);statuses.push(loaded.status);
   }
   return {statuses,async lookup(leg){
    let matches=outputs.map(o=>o[leg.leg_id]).filter(r=>r?.observation);
    // Fresh means fetched/checked within four hours, not that the weekly timetable was published today.
    // Refresh an old participating source once; a failed refresh cannot erase the contradiction.
    let refreshFailed=false;
    if(matches.length>1)for(let i=0;i<feeds.length;i++){
     const old=outputs[i][leg.leg_id];if(!old?.observation||sourceCheckFresh(old,clock()))continue;
     if(refreshed.has(i))continue;refreshed.add(i);
     const loaded=await load(feeds[i],legs);statuses[i]=loaded.status;
     if(!loaded.rows[leg.leg_id]?.observation){refreshFailed=true;continue;}outputs[i]=loaded.rows;
    }
    matches=outputs.map(o=>o[leg.leg_id]).filter(r=>r?.observation);
    if(refreshFailed)return {sourceConflict:true,reason:'Andere bron opnieuw geraadpleegd maar niet bevestigd; handmatig controleren',sources:matches.flatMap(m=>m.sources)};
    const result=reconcilePlanningSources(matches,clock());
    if(result?.sourceConflict)return result;
    const actualNumbers=[...new Set(matches.map(m=>trainDigits(m.observation.train_number||leg.train_number)).filter(Boolean))];
    if(actualNumbers.length>1&&matches.some(m=>numberAssessment(leg,m.observation).notify))return {sourceConflict:true,reason:'Bronnen spreken elkaar tegen over het treinnummer: '+actualNumbers.join(' / ')+'. Treinnummer en reservering handmatig controleren; bronnen binnen vier uur geraadpleegd.',sources:result.sources};
    if(result&&Date.parse(result.observation.observed_at)<Date.parse(leg.observation?.observed_at))return {reason:'Bron ouder dan de laatst vastgelegde controle; handmatig beoordelen',sources:result.sources};
    if(result&&(!leg.departure_time||!leg.arrival_time))return {reason:'Oorspronkelijke tijden ontbreken; eerst reisschema controleren',sources:result.sources};
    return applyNumberPolicy(leg,result,clock())||{reason:outputs.map(o=>o[leg.leg_id]?.reason).filter(Boolean).join('; ')||'Geen bruikbare bron; controleer DB',sources:outputs.flatMap(o=>o[leg.leg_id]?.sources||[])};
   }};
  }};
}
if(!isMainThread&&workerData?.kind)parentPort.postMessage((workerData.kind==='iff'?parseIff:parseGtfs)(workerData.bytes,workerData.legs,workerData.meta));
