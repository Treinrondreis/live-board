import {createClient} from 'hafas-client';
import {profile} from 'hafas-client/p/oebb/index.js';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';
import {recordPunctuality} from './punctuality.mjs';
export const oebbStations={'wien-oebb':{name:'Wien Hbf',stop:'8103000',country:'AT'},'salzburg-oebb':{name:'Salzburg Hbf',stop:'8100002',country:'AT'},'innsbruck-oebb':{name:'Innsbruck Hbf',stop:'8100108',country:'AT'},'graz-oebb':{name:'Graz Hbf',stop:'8100173',country:'AT'}};
export const oebbState={status:'starting',lastSuccessAt:null,error:null};
const cache=new Map(),clock=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'}).format(t);
const client=createClient({...profile,transformReq:(ctx,req)=>({...profile.transformReq?.(ctx,req)||req,signal:AbortSignal.timeout(25000)})},'Treinrondreis departure boards');let busy=false;
export function oebbRows(page,departures,at=Date.now()){
 return departures.flatMap(d=>{const planned=Date.parse(d.plannedWhen||d.when);if(!Number.isFinite(planned)||d.line?.mode!=='train')return [];
 const when=Date.parse(d.when),hasRealtime=Number.isFinite(d.delay),expected=hasRealtime&&Number.isFinite(when)?when:planned;
 const number=String(d.line.fahrtNr||d.line.name?.match(/\d+/)?.[0]||''),category=d.line.productName||d.line.name?.split(' ')[0]||'Trein';
 const cancelled=d.cancelled===true,track=cancelled?'—':d.platform||d.plannedPlatform||'—',id=[page,d.tripId,planned].join('|');
 return [{id,source:'OEBB',sourceTripId:d.tripId,number,category,train:d.line.name||category+' '+number,observedAt:oebbStations[page].name,eventMode:'departure',countryCode:'AT',plannedTimestamp:planned,expectedTimestamp:expected,plannedTime:clock(planned),time:clock(planned),currentTime:clock(expected),track,plannedTrack:d.plannedPlatform||'',currentTrack:d.platform||'',hasRealtime,delay:hasRealtime?Math.round(d.delay/60):0,cancelled,status:cancelled?'Geannuleerd':hasRealtime?(d.delay?'Vertraging':'Op tijd'):'',from:oebbStations[page].name,to:d.direction||d.destination?.name||'—',futureRoute:[d.direction||d.destination?.name].filter(Boolean),messageTimestamp:at}];});
}
export async function scanOebb(){if(busy)return;busy=true;try{
 for(const [page,s] of Object.entries(oebbStations)){const d=await client.departures(s.stop,{duration:1440,results:1000,products:{nationalExpress:true,national:true,interregional:true,regional:true,suburban:true,bus:false,ferry:false,subway:false,tram:false,onCall:false}});const at=Date.now(),rows=oebbRows(page,d.departures||d,at);const saved={at,rows};cache.set(page,saved);await saveBoardCache('OEBB:'+page,saved,at);await recordPunctuality(rows,'OEBB',at);}
 oebbState.status='ready';oebbState.error=null;oebbState.lastSuccessAt=new Date().toISOString();
 }catch(e){oebbState.status='error';oebbState.error=e.message;}finally{busy=false;}}
export async function restoreOebb(){for(const page of Object.keys(oebbStations)){const saved=await loadBoardCache('OEBB:'+page);if(saved)cache.set(page,saved);}}
export function startOebb(){void scanOebb();setInterval(()=>void scanOebb(),180000).unref();}
export function oebbPayload(page,now=Date.now()){
 if(!oebbStations[page])return null;const saved=cache.get(page),stale=!saved||now-saved.at>360000;
 const rows=(saved?.rows||[]).filter(r=>r.expectedTimestamp>=now-60000).map(r=>stale?{...r,hasRealtime:false,delay:0,expectedTimestamp:r.plannedTimestamp,currentTime:r.plannedTime,currentTrack:'',track:r.plannedTrack||'—',status:r.cancelled?'Geannuleerd':''}:r).sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
 const fern=r=>/^(NJ|EN|RJ|RJX|ICE|IC|EC|D)$/.test(r.category),night=rows.filter(r=>/^(NJ|EN)$/.test(r.category));
 return {page,station:oebbStations[page].name,title:'Vertrektijden '+oebbStations[page].name,country:'AT',source:'OEBB · Scotty',lastScanAt:saved?new Date(saved.at).toISOString():null,status:stale?'stale':oebbState.status,notice:stale?'Actuele ÖBB-gegevens zijn tijdelijk niet beschikbaar.':'',quick:[{id:'nightjet',label:'Nightjet / EuroNight',count:night.length,trains:night.slice(0,8)}],departures:{all:rows,fernverkehr:rows.filter(fern),regional:rows.filter(r=>!fern(r))}};
}
