import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {saveBoardCache,loadBoardCache} from './board-cache.mjs';

export const czechStations={praha:{name:'Praha hlavní nádraží'},'praha-holesovice':{name:'Praha-Holešovice'}};
const longDistance=new Set(['EC','IC','ICE','RJ','RJX','SC','EN','NJ','EX','LE','RJI','R']);
const clock=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Prague',hour:'2-digit',minute:'2-digit'});
let snapshot=null,busy=false,started=false;
export const czechArchiveState={status:'starting',lastCheckedAt:null,lastObservationAt:null};

export function czechArchiveRows(data,now=Date.now()){
  if(!data?.plan?.rows)return [];
  const updates=new Map();
  for(const u of data.updates||[]){
    if(u.version!==data.plan.version||!u.service_day||!Number.isFinite(u.observed)||u.observed>now)continue;
    const key=u.trip_id+'|'+u.service_day,old=updates.get(key);
    if(!old||old.observed<u.observed)updates.set(key,u);
  }
  return data.plan.rows.map(p=>{
    const u=updates.get(p.trip_id+'|'+p.date.replaceAll('-',''));
    const fresh=u&&now-u.observed<=90*60000;
    const call=fresh?(u.stops||[]).find(s=>Number(s.stopSequence)===Number(p.stop_sequence)&&
      s.stopId?.replace(/:platform:.*$/,'')===p.stop_id.replace(/:platform:.*$/,'')):null;
    const cancelled=Boolean(fresh&&(u.relationship==='CANCELED'||call?.scheduleRelationship==='SKIPPED'));
    const event=call?.scheduleRelationship==='NO_DATA'?null:call?.departure;
    const expected=event?.time!=null?Number(event.time)*1000:
      event?.delay!=null?p.plannedTimestamp+Number(event.delay)*1000:null;
    const hasRealtime=Number.isFinite(expected)&&Math.abs(expected-p.plannedTimestamp)<12*3600000;
    const train=String(p.trip_short_name||'Trein').trim();
    const category=train.match(/^[a-z]+/i)?.[0].toUpperCase()||'';
    const futureRoute=[...new Set(p.future_route||[])];
    return {
      id:['TRAIN_ARCHIVE_CZ',p.date,p.trip_id,p.stop_sequence].join('|'),page:p.page,
      source:'TRAIN_ARCHIVE_CZ',train,number:train.match(/\d+/)?.[0]||'',category,transportMode:'rail',
      to:p.trip_headsign||futureRoute.at(-1)||'—',route:futureRoute,futureRoute,
      plannedTimestamp:p.plannedTimestamp,expectedTimestamp:hasRealtime?expected:p.plannedTimestamp,
      plannedTime:clock.format(p.plannedTimestamp),time:clock.format(p.plannedTimestamp),
      track:p.platform_code||'—',delay:hasRealtime?Math.round((expected-p.plannedTimestamp)/60000):null,
      hasRealtime,cancelled,messageTimestamp:fresh?u.observed:null,
      status:cancelled?'Geannuleerd':hasRealtime?((expected>p.plannedTimestamp?'+':'')+Math.round((expected-p.plannedTimestamp)/60000)+' min'):'Geen vertragingsmeting',
    };
  }).filter(r=>Math.max(r.plannedTimestamp,r.expectedTimestamp)>=now-60000&&r.plannedTimestamp<now+6*3600000)
    .sort((a,b)=>a.plannedTimestamp-b.plannedTimestamp);
}

export function czechArchivePayload(page,now=Date.now()){
  if(!Object.hasOwn(czechStations,page))return null;
  const all=czechArchiveRows(snapshot,now).filter(r=>r.page===page);
  const age=snapshot?.latestObservation?Math.max(0,Math.floor((now-snapshot.latestObservation)/60000)):null;
  return {page,station:czechStations[page].name,title:czechStations[page].name,country:'CZ',
    source:'Správa železnic / obehy.cz via Train Archive',archiveDelayed:true,status:all.length?'ready':'starting',
    lastScanAt:snapshot?.latestObservation?new Date(snapshot.latestObservation).toISOString():null,
    notice:'Archiefgegevens met vertraging. '+(age===null?'Nog geen vertragingsmetingen beschikbaar.':'Nieuwste meting '+age+' minuten oud. ')+
      'Dienstregeling aangevuld met beschikbare metingen. Bron: Správa železnic / obehy.cz, gearchiveerd door train-archive.eu.',
    quick:[],
    departures:{all,fernverkehr:all.filter(r=>longDistance.has(r.category)),regional:all.filter(r=>!longDistance.has(r.category))}};
}

export async function restoreCzechArchive(){
  const saved=await loadBoardCache('TRAIN_ARCHIVE_CZ:board');
  if(saved?.plan?.rows)snapshot=saved;
}

export async function scanCzechArchive(){
  const token=process.env.TRAIN_ARCHIVE_API_TOKEN;
  if(busy||!token)return;
  busy=true;
  try{
    const result=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL(import.meta.url),{workerData:{czechArchive:true,token,plan:snapshot?.plan},resourceLimits:{maxOldGenerationSizeMb:128}});
      const timeout=setTimeout(()=>{void worker.terminate();reject(Error('Archive reader timeout'));},180000);
      worker.once('message',m=>{clearTimeout(timeout);m.ok?resolve(m.data):reject(Error('Archive read failed'));});
      worker.once('error',()=>{clearTimeout(timeout);reject(Error('Archive worker failed'));});
      worker.once('exit',code=>{clearTimeout(timeout);if(code)reject(Error('Archive worker stopped'));});
    });
    snapshot=result;
    czechArchiveState.status='ready';
    czechArchiveState.lastCheckedAt=new Date().toISOString();
    czechArchiveState.lastObservationAt=result.latestObservation?new Date(result.latestObservation).toISOString():null;
    await saveBoardCache('TRAIN_ARCHIVE_CZ:board',result);
  }catch{
    czechArchiveState.status='unavailable';
    console.warn('[Train Archive CZ] Gegevens tijdelijk niet opgehaald; bewaarde dienstregeling blijft beschikbaar.');
  }finally{busy=false;}
}

export function startCzechArchive(){
  if(started)return;
  started=true;
  void scanCzechArchive();
  setInterval(()=>void scanCzechArchive(),5*60000).unref();
}

if(!isMainThread&&workerData?.czechArchive){
  const {readCzechArchive}=await import('./archive-czech-reader.mjs');
  try{parentPort.postMessage({ok:true,data:await readCzechArchive(workerData)});}
  catch{parentPort.postMessage({ok:false});}
}
