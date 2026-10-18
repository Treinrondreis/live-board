// Official OJP, using the existing board credential. Only public station/date information leaves the server.
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {swissStations} from './swiss-stations.mjs';
import {trainDigits} from './reisschema-number-policy.mjs';
const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,ignoreAttributes:true});
const list=v=>v==null?[]:Array.isArray(v)?v:[v];
const text=v=>v&&typeof v==='object'?text(v.Text??v['#text']):String(v??'');
const yes=v=>v===true||v==='true'||v==='1';
const norm=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const known=new Map(Object.values(swissStations).map(s=>[norm(s.name),{name:s.name,id:s.id}]));
for(const [name,id] of [['Thun (See)','ch:1:sloid:7150'],['Interlaken West (See)','ch:1:sloid:7169'],['Interlaken Ost (See)','ch:1:sloid:8370']])known.set(norm(name),{name,id});
const refMatches=(value,id)=>!!id&&(value===id||value.startsWith(id+':')||value.startsWith(id+'_gen:'));
export const swissEligible=leg=>['train','ferry'].includes(leg.transport_type||'train')&&(['from','to'].some(side=>known.has(norm(leg[side+'_station']))||/^ch:1:sloid:/.test(leg[side+'_station_id']||'')||leg[side+'_country']==='CH'));
const wrap=(body,now)=>`<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0"><OJPRequest><siri:ServiceRequest><siri:ServiceRequestContext><siri:Language>de</siri:Language></siri:ServiceRequestContext><siri:RequestTimestamp>${new Date(now).toISOString()}</siri:RequestTimestamp><siri:RequestorRef>Treinrondreis_prod</siri:RequestorRef>${body}</siri:ServiceRequest></OJPRequest></OJP>`;
function delivery(xml,kind,now){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Ongeldige OJP XML');
 const root=parser.parse(xml)?.OJP?.OJPResponse?.ServiceDelivery,data=root?.[kind],at=Date.parse(data?.ResponseTimestamp||root?.ResponseTimestamp);
 if(!data||root.Status==='false'||data.Status==='false'||data.ErrorCondition||root.ErrorCondition||!Number.isFinite(at)||now-at>7*60000||at>now+60000)throw Error('OJP-antwoord niet bruikbaar');
 return data;
}
// Explicit timezone on the query date, including the winter/summer transition.
export function swissQueryTime(leg){
 const base=Date.parse(leg.travel_date+'T00:00:00Z');
 const zone=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',timeZoneName:'longOffset'}).formatToParts(base).find(p=>p.type==='timeZoneName').value.replace('GMT','');
 const midnight=Date.parse(leg.travel_date+'T00:00:00'+zone);
 if(leg.transport_type==='ferry'||!/^\d{2}:\d{2}$/.test(leg.departure_time||''))return new Date(midnight).toISOString();
 const expectedZone=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',timeZoneName:'longOffset'}).formatToParts(Date.parse(leg.travel_date+'T'+leg.departure_time+':00Z')).find(p=>p.type==='timeZoneName').value.replace('GMT','');
 const expected=Date.parse(leg.travel_date+'T'+leg.departure_time+':00'+expectedZone);
 return new Date(Math.max(midnight,expected-3600000)).toISOString();
}
export function swissPlanningRequest(leg,station,now){
 return wrap(`<OJPStopEventRequest><siri:RequestTimestamp>${new Date(now).toISOString()}</siri:RequestTimestamp><Location><PlaceRef><StopPlaceRef>${escape(station.id)}</StopPlaceRef><Name><Text>${escape(station.name)}</Text></Name></PlaceRef><DepArrTime>${swissQueryTime(leg)}</DepArrTime></Location><Params><ModeFilter><Exclude>false</Exclude><PtMode>${leg.transport_type==='ferry'?'water':'rail'}</PtMode></ModeFilter><NumberOfResults>200</NumberOfResults><StopEventType>departure</StopEventType><IncludePreviousCalls>true</IncludePreviousCalls><IncludeOnwardCalls>true</IncludeOnwardCalls><UseRealtimeData>explanatory</UseRealtimeData><IncludePlacesContext>false</IncludePlacesContext><IncludeSituationsContext>false</IncludeSituationsContext></Params></OJPStopEventRequest>`,now);
}
const local=value=>{
 // A missing timezone must never be silently interpreted in the server's timezone.
 if(!/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value||''))return null;
 const at=Date.parse(value);if(!Number.isFinite(at))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,at};
};
export function parseSwissPlanning(xml,leg,meta){
 const data=delivery(xml,'OJPStopEventDelivery',Date.parse(meta.loadedAt)),found=new Map();
 const evidence={source:'Zwitserland OJP',downloaded_at:meta.loadedAt,query_date:leg.travel_date,stop_id:meta.station.id};
 for(const result of list(data.StopEventResult)){
  const e=result.StopEvent,s=e?.Service;if(!s||s.Mode?.PtMode!==(leg.transport_type==='ferry'?'water':'rail'))continue;
  const number=text(s.TrainNumber),exact=!!trainDigits(leg.train_number)&&trainDigits(number)===trainDigits(leg.train_number);
  const calls=[...list(e.PreviousCall),...list(e.ThisCall),...list(e.OnwardCall)].map(v=>v.CallAtStop).filter(Boolean);
  const starts=calls.map((c,i)=>({c,i})).filter(({c})=>refMatches(text(c.StopPointRef),meta.station.id));
  const ends=calls.map((c,i)=>({c,i})).filter(({c})=>refMatches(text(c.StopPointRef),meta.destination?.id)||norm(text(c.StopPointName))===norm(leg.to_station));
  if(starts.length!==1||ends.length!==1||starts[0].i>=ends[0].i)continue;
  const a=starts[0].c,b=ends[0].c,departure=local(a.ServiceDeparture?.TimetabledTime),arrival=local(b.ServiceArrival?.TimetabledTime);
  if(!departure||!arrival||departure.date!==leg.travel_date||departure.at>=arrival.at)continue;
  const cancelled=yes(s.Cancelled)||yes(a.Cancelled)||yes(a.NotServicedStop)||yes(b.Cancelled)||yes(b.NotServicedStop);
  if(!cancelled&&(yes(a.NoBoardingAtStop)||yes(b.NoAlightingAtStop)))continue;
  // Changed/missing numbers can only match the unique original full date/time pair.
  if(!exact&&(departure.time!==leg.departure_time||arrival.time!==leg.arrival_time||arrival.date!==(leg.arrival_date||leg.travel_date)))continue;
  if(!number&&leg.transport_type!=='ferry')continue;
  const ref=text(s.JourneyRef),day=text(s.OperatingDayRef);if(!ref||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
  const category=text(s.ProductCategory?.ShortName)||text(s.Mode?.ShortName)||(leg.transport_type==='ferry'?'Boot':'');
  const observation={departure_date:departure.date,departure_time:departure.time,arrival_date:arrival.date,arrival_time:arrival.time,train_number:number?[category,number].filter(Boolean).join(' '):leg.train_number||'',cancelled,connection_broken:false,backup_communicated:false,source:'Zwitserland OJP',observed_at:meta.loadedAt};
  const candidate={exact,observation,sources:[JSON.stringify({...evidence,journey_ref:ref,operating_day:day})]};
  const identity=JSON.stringify([ref,day,observation]);found.set(identity,candidate);
 }
 const rows=[...found.values()],matches=rows.some(r=>r.exact)?rows.filter(r=>r.exact):rows;
 return matches.length===1?matches[0]:{reason:matches.length?'Zwitserland: meerdere passende ritten; niet gecontroleerd':'Zwitserland: geen eenduidige volledige rit gevonden; annulering niet vastgesteld',sources:[JSON.stringify(evidence)]};
}
export function createSwissPlanningSource({env=process.env,fetcher=fetch,clock=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const cache=new Map(),locations=new Map();let cacheBytes=0,count=0,last=-Infinity,blocked=false;
 async function request(body,heartbeat){
  if(blocked||count>=100)throw Error('OJP-aanvraaglimiet');
  await heartbeat();await pause(Math.max(0,1100-(clock()-last)));last=clock();count++;
  const response=await fetcher('https://api.opentransportdata.swiss/ojp20',{method:'POST',redirect:'error',headers:{'Content-Type':'application/xml',Authorization:'Bearer '+env.OJP_API_KEY.trim().replace(/^Bearer\s+/i,''),'User-Agent':'Treinrondreis/1.0'},body,signal:AbortSignal.timeout(25000)});
  if(response.status===429)blocked=true;if(!response.ok)throw Error('OJP niet bereikbaar');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024)throw Error('OJP antwoord te groot');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
 }
 async function resolve(leg,side,heartbeat){
  const name=leg[side+'_station'],id=leg[side+'_station_id'];
  if(/^ch:1:sloid:[0-9]+$/.test(id||''))return {name,id};
  if(known.has(norm(name)))return known.get(norm(name));
  if(locations.has(norm(name)))return locations.get(norm(name));
  const xml=await request(wrap(`<OJPLocationInformationRequest><siri:RequestTimestamp>${new Date(clock()).toISOString()}</siri:RequestTimestamp><InitialInput><Name>${escape(name)}</Name></InitialInput><Restrictions><Type>stop</Type><NumberOfResults>10</NumberOfResults></Restrictions></OJPLocationInformationRequest>`,clock()),heartbeat);
  const data=delivery(xml,'OJPLocationInformationDelivery',clock()),matches=list(data.PlaceResult).flatMap(r=>{
   const p=r.Place,s=p?.StopPlace,n=text(s?.StopPlaceName)||text(p?.Name),ref=text(s?.StopPlaceRef);
   return norm(n)===norm(name)&&/^ch:1:sloid:\d+$/.test(ref)?[{name:n,id:ref}]:[];
  });
  const unique=[...new Map(matches.map(s=>[s.id,s])).values()],found=unique.length===1?unique[0]:null;locations.set(norm(name),found);return found;
 }
 return {async lookup(leg,heartbeat=async()=>{}){
  if(!env.OJP_API_KEY?.trim()||env.REISSCHEMA_SWISS_ENABLED==='0'||!swissEligible(leg))return {reason:'Geen Zwitserse controle beschikbaar',sources:[]};
  try{
   const station=await resolve(leg,'from',heartbeat),destination=await resolve(leg,'to',heartbeat);if(!station||!destination)return {reason:'Zwitserland: stations niet eenduidig herkend',sources:[]};
   const key=JSON.stringify([station.id,swissQueryTime(leg),leg.transport_type==='ferry'?'water':'rail']);
   if(!cache.has(key)){
    const xml=await request(swissPlanningRequest(leg,station,clock()),heartbeat),bytes=Buffer.byteLength(xml);
    while(cacheBytes+bytes>16*1024*1024&&cache.size){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).bytes;cache.delete(oldest);}
    cache.set(key,{xml,bytes,loadedAt:new Date(clock()).toISOString()});cacheBytes+=bytes;
   }
   return parseSwissPlanning(cache.get(key).xml,leg,{...cache.get(key),station,destination});
  }catch{return {reason:'Zwitserland niet bereikbaar of antwoord niet bruikbaar; geen annulering vastgesteld',sources:[]};}
 }};
}
