import {createHash,randomUUID} from 'node:crypto';
import {changeKey} from './reisschema-changes.mjs';
import {numberAssessment,controlPolicy} from './reisschema-number-policy.mjs';

export const dayAt=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const localMinute=now=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);return Number(p.find(x=>x.type==='hour').value)*60+Number(p.find(x=>x.type==='minute').value);};
export const dailyControlDue=now=>localMinute(now)>=30;
export function nextDailyControlAt(now){
 for(let offset=0;offset<3;offset++){
  const day=new Date(Date.parse(dayAt(now))+offset*86400000).toISOString().slice(0,10),base=Date.parse(day+'T00:30:00Z');
  const zone=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',timeZoneName:'longOffset'}).formatToParts(base).find(p=>p.type==='timeZoneName').value.replace('GMT','');
  const at=Date.parse(day+'T00:30:00'+zone);if(at>now)return new Date(at).toISOString();
 }
 throw Error('Volgende controledag niet gevonden');
}
export const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const minute=(date,time)=>Date.parse(date+'T'+time+':00Z')/60000;
export const fingerprint=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
export function assess(leg,o){
 const departure=minute(o.departure_date,o.departure_time)-minute(leg.travel_date,leg.departure_time);
 const arrival=minute(o.arrival_date,o.arrival_time)-minute(leg.arrival_date||leg.travel_date,leg.arrival_time);
 const n=numberAssessment(leg,o),stationChanged=!!o.station_changed,changed=departure!==0||arrival!==0||o.cancelled||o.connection_broken||stationChanged||n.notify;
 return {changed,departure,arrival,urgent:departure<=-4||o.cancelled||o.connection_broken||stationChanged,
  draftRequired:Math.abs(departure)>=4||o.cancelled||o.connection_broken||stationChanged||n.notify,
  reservationReview:!!(o.cancelled||o.connection_broken||stationChanged||n.notify),backupReview:changed,
  tightConnectionReview:false};
}
export function dueLeg(leg,today,usable){
 if(leg.status!=='active'||!['train','ferry'].includes(leg.transport_type||'train'))return false;
 const days=(Date.parse(leg.travel_date)-Date.parse(today))/86400000;
 return usable?days>=0&&days<=15:days===8;
}
export function connections(rows){
 return rows.map(row=>{
  if(!row.observation||row.role==='backup')return row;
  const next=rows.filter(r=>r.version_id===row.version_id&&r.role!=='backup'&&+r.sequence>+row.sequence).sort((a,b)=>a.sequence-b.sequence)[0];
  if(!next||norm(row.to_station)!==norm(next.from_station))return row;
  const oldGap=minute(next.travel_date,next.departure_time)-minute(row.arrival_date||row.travel_date,row.arrival_time);
  const arr=row.observation,dep=next.observation;
  // An unchecked onward train is never treated as a verified departure.
  const gap=dep?minute(dep.departure_date,dep.departure_time)-minute(arr.arrival_date,arr.arrival_time):NaN;
  const observation={...arr,connection_broken:Number.isFinite(gap)&&gap<=0,backup_communicated:false,connection_calculated:true};
  observation.change_key=changeKey(row.leg_id,observation,row);
  return {...row,observation,tightConnectionReview:Number.isFinite(gap)&&gap>0&&gap<oldGap};
 });
}

// Durable checkpoint/lease and central append-only evidence. No timetable fetch in a GET handler.
export function createControlCycle({register,read,write,sources,clock=Date.now}){
 let running=false;
 async function tick({manual=false,legIds=null}={}){
  if(running)return;running=true;
  const owner=randomUUID();let checkpoint,revision;
  const save=async()=>{revision=await write('reisschema-control',checkpoint,revision);};
  try{
   const stored=await read('reisschema-control');checkpoint=stored.value;revision=stored.revision;
   if(checkpoint.enabled!==true&&!manual||checkpoint.leaseUntil>clock())return;
   const today=dayAt(clock());
   if(!manual&&(!dailyControlDue(clock())||checkpoint.lastScheduledDay===today&&!checkpoint.queue?.length))return;
   checkpoint={...checkpoint,owner,leaseUntil:clock()+300000,error:null};await save();
   const data=await register.summary();if(!data.available)throw Error('register');
   const requested=legIds||((checkpoint.queue?.length&&checkpoint.queueLegIds)||null);
   const selected=data.legs.filter(r=>requested?requested.includes(r.leg_id)&&r.status==='active'&&['train','ferry'].includes(r.transport_type||'train'):dueLeg(r,today,true));
   const selectionKey=fingerprint(selected.map(r=>r.leg_id).sort());
   if(!selected.length){checkpoint.lastRun=new Date(clock()).toISOString();checkpoint.queue=[];checkpoint.lastSummary={selected:0,checked:0,manual:0,pending:0,sources:[]};if(!manual&&!requested)checkpoint.lastScheduledDay=today;return;}
   const staleEvidence=r=>clock()-Date.parse(r.controlAt)>4*3600000||(r.result?.sources||[]).some(s=>{try{const at=Date.parse(JSON.parse(s).downloaded_at);return Number.isFinite(at)&&clock()-at>4*3600000;}catch{return false;}});
   if(checkpoint.queueDay!==today||checkpoint.queueSelection!==selectionKey||manual&&!checkpoint.queue?.length||checkpoint.queue?.some(staleEvidence)){
    checkpoint.queueLegIds=requested;
    checkpoint.queueRun=randomUUID();
    checkpoint.queueScheduled=!requested&&!manual;
    const prepared=await sources.prepare(selected,async()=>{checkpoint.leaseUntil=clock()+300000;await save();}),checked=[];
    for(const row of selected){
     checkpoint.leaseUntil=clock()+300000;await save();
     let result;try{result=await prepared.lookup(row);}catch{result={reason:'Bron niet bereikbaar of verwerking mislukt',sources:[]};}
     const days=(Date.parse(row.travel_date)-Date.parse(today))/86400000;
     // Missing coverage is neutral; only a demonstrated conflict needs manual attention.
     const due=!!requested||result.observation||result.sourceConflict||row.control?.outcome==='checked'||days<=8&&!row.control;
     if(due)checked.push({...row,result,observation:result.observation||null,controlAt:new Date(clock()).toISOString()});
    }
    checkpoint.queue=connections(checked);checkpoint.queueDay=today;checkpoint.queueSelection=selectionKey;
    checkpoint.lastSummary={selected:selected.length,checked:checked.filter(r=>r.observation).length,manual:checked.filter(r=>r.result.sourceConflict).length,unchecked:selected.length-checked.filter(r=>r.observation||r.result.sourceConflict).length,extraDb:checked.filter(r=>controlPolicy({control:{sources:r.result.sources}}).extra_db_required).length,numberNotices:checked.filter(r=>r.observation&&numberAssessment(r,r.observation).notify).length,pending:checked.length,sources:prepared.statuses||[]};await save();
   }
   for(const row of checkpoint.queue||[]){
    const runKey=checkpoint.queueRun||today;
    if(checkpoint.done?.[row.leg_id]===runKey)continue;
    const current=await register.summary();
    if(!current.available)throw Error('register');
    if(!current.legs.some(r=>r.leg_id===row.leg_id&&r.version_id===row.version_id&&r.status==='active'))continue;
    const requestId='auto-'+fingerprint(checkpoint.queueRun?[row.version_id,row.leg_id,today,checkpoint.queueRun]:[row.version_id,row.leg_id,today]);
    const {result}=row,at=row.controlAt;
    const assessment=row.observation?{...assess(row,row.observation),tightConnectionReview:!!row.tightConnectionReview}:null;
    if(row.observation){
     const {change_key,...observation}=row.observation;
     await register.recordLegEvent(row.version_id,'observation',{...observation,leg_id:row.leg_id,request_id:requestId+'-obs'});
    }
    await register.recordLegEvent(row.version_id,'control',{leg_id:row.leg_id,request_id:requestId,
     checked_at:at,day:today,outcome:row.observation?'checked':'manual',reason:result.reason||'',
     sources:[...(result.sources||[]),JSON.stringify({kind:'planning-control',attention:!!result.sourceConflict})],assessment,observation_request_id:row.observation?requestId+'-obs':null,
     // Keep the register's legacy manual shape; attention is explicitly separate in source metadata.
     manual_url:row.observation?null:'https://int.bahn.de/nl'});
    checkpoint.done={...(checkpoint.done||{}),[row.leg_id]:runKey};
    if(checkpoint.lastSummary)checkpoint.lastSummary.pending=Math.max(0,checkpoint.lastSummary.pending-1);await save();
   }
   const active=new Set(data.legs.map(r=>r.leg_id));checkpoint.done=Object.fromEntries(Object.entries(checkpoint.done||{}).filter(([id])=>active.has(id)));
   checkpoint.lastRun=new Date(clock()).toISOString();checkpoint.lastSelection=selectionKey;checkpoint.queue=[];checkpoint.queueLegIds=null;
   if(checkpoint.queueScheduled)checkpoint.lastScheduledDay=today;
  }catch{if(checkpoint?.owner===owner)checkpoint.error='Controle niet voltooid. Niet-afgeronde ritten worden opnieuw geprobeerd; ontbrekende bronnen blijven handmatig te controleren.';}
  finally{try{if(checkpoint?.owner===owner){checkpoint.leaseUntil=0;await save();}}catch{}running=false;}
 }
 return {tick,async requestSelected(legIds){
  if(!Array.isArray(legIds)||!legIds.length||legIds.length>100||new Set(legIds).size!==legIds.length||legIds.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(id)))return {accepted:false,reason:'Selecteer 1 tot 100 ritregels.'};
  const {value}=await read('reisschema-control');if(running||value.leaseUntil>clock()||value.queue?.length)return {accepted:false,reason:'Er loopt nog een controle of er staan resultaten klaar. Rond die eerst af.'};
  const data=await register.summary();if(!data.available||legIds.some(id=>!data.legs.some(r=>r.leg_id===id&&r.status==='active'&&['train','ferry'].includes(r.transport_type||'train'))))return {accepted:false,reason:'Selectie is niet meer actueel. Vernieuw de pagina.'};
  if(running)return {accepted:false,reason:'Er loopt al een controle.'};
  void tick({manual:true,legIds}).catch(()=>{});return {accepted:true,count:legIds.length};
 },async status(){const {value}=await read('reisschema-control');return {enabled:value.enabled===true,scheduleTime:'00:30',timeZone:'Europe/Amsterdam',nextRunAt:nextDailyControlAt(clock()),lastRun:value.lastRun||null,summary:value.lastSummary||null,error:value.error||null,running:value.leaseUntil>clock()};},async enable(enabled){if(typeof enabled!=='boolean')throw Error('Ongeldige instelling');const {value,revision}=await read('reisschema-control');await write('reisschema-control',{...value,enabled,...(enabled&&!value.enabled&&dailyControlDue(clock())?{lastScheduledDay:dayAt(clock())}:{})},revision);}};
}
