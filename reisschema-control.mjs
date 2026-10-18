import {createHash,randomUUID} from 'node:crypto';
import {changeKey} from './reisschema-changes.mjs';

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
 const stationChanged=!!o.station_changed,changed=departure!==0||arrival!==0||o.cancelled||o.connection_broken||stationChanged;
 return {changed,departure,arrival,urgent:departure<=-4||o.cancelled||o.connection_broken||stationChanged,
  draftRequired:Math.abs(departure)>=4||o.cancelled||o.connection_broken||stationChanged,
  reservationReview:!!(o.cancelled||o.connection_broken||stationChanged),backupReview:changed,
  tightConnectionReview:false};
}
export function dueLeg(leg,today,usable){
 if(leg.status!=='active'||(leg.transport_type||'train')!=='train')return false;
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
  observation.change_key=changeKey(row.leg_id,observation);
  return {...row,observation,tightConnectionReview:!dep||Number.isFinite(gap)&&gap>0&&gap<oldGap};
 });
}

// Durable checkpoint/lease and central append-only evidence. No timetable fetch in a GET handler.
export function createControlCycle({register,read,write,sources,clock=Date.now}){
 let running=false;
 async function tick({manual=false}={}){
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
   const selected=data.legs.filter(r=>dueLeg(r,today,true));
   const selectionKey=fingerprint(selected.map(r=>r.leg_id).sort());
   if(!selected.length){checkpoint.lastRun=new Date(clock()).toISOString();checkpoint.queue=[];checkpoint.lastSummary={selected:0,checked:0,manual:0,pending:0,sources:[]};if(!manual)checkpoint.lastScheduledDay=today;return;}
   if(checkpoint.queueDay!==today||checkpoint.queueSelection!==selectionKey||manual&&!checkpoint.queue?.length||checkpoint.queue?.some(r=>clock()-Date.parse(r.controlAt)>4*3600000)){
    checkpoint.queueRun=randomUUID();
    checkpoint.queueScheduled=!manual;
    const prepared=await sources.prepare(selected,async()=>{checkpoint.leaseUntil=clock()+300000;await save();}),checked=[];
    for(const row of selected){
     checkpoint.leaseUntil=clock()+300000;await save();
     let result;try{result=await prepared.lookup(row);}catch{result={reason:'Bron niet bereikbaar of verwerking mislukt',sources:[]};}
     const days=(Date.parse(row.travel_date)-Date.parse(today))/86400000;
     // No usable data: one visible DB task at D-8 (or overdue on late registration).
     const due=result.observation||result.sourceConflict||row.control?.outcome==='checked'||days<=8&&!row.control;
     if(due)checked.push({...row,result,observation:result.observation||null,controlAt:new Date(clock()).toISOString()});
    }
    checkpoint.queue=connections(checked);checkpoint.queueDay=today;checkpoint.queueSelection=selectionKey;
    checkpoint.lastSummary={selected:selected.length,checked:checked.filter(r=>r.observation).length,manual:checked.filter(r=>!r.observation).length,pending:checked.length,sources:prepared.statuses||[]};await save();
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
     sources:result.sources||[],assessment,observation_request_id:row.observation?requestId+'-obs':null,
     manual_url:row.observation?null:'https://int.bahn.de/nl'});
    checkpoint.done={...(checkpoint.done||{}),[row.leg_id]:runKey};
    if(checkpoint.lastSummary)checkpoint.lastSummary.pending=Math.max(0,checkpoint.lastSummary.pending-1);await save();
   }
   const active=new Set(data.legs.map(r=>r.leg_id));checkpoint.done=Object.fromEntries(Object.entries(checkpoint.done||{}).filter(([id])=>active.has(id)));
   checkpoint.lastRun=new Date(clock()).toISOString();checkpoint.lastSelection=selectionKey;checkpoint.queue=[];
   if(checkpoint.queueScheduled)checkpoint.lastScheduledDay=today;
  }catch{if(checkpoint?.owner===owner)checkpoint.error='Controle niet voltooid. Niet-afgeronde ritten worden opnieuw geprobeerd; ontbrekende bronnen blijven handmatig te controleren.';}
  finally{try{if(checkpoint?.owner===owner){checkpoint.leaseUntil=0;await save();}}catch{}running=false;}
 }
 return {tick,async status(){const {value}=await read('reisschema-control');return {enabled:value.enabled===true,scheduleTime:'00:30',timeZone:'Europe/Amsterdam',nextRunAt:nextDailyControlAt(clock()),lastRun:value.lastRun||null,summary:value.lastSummary||null,error:value.error||null,running:value.leaseUntil>clock()};},async enable(enabled){if(typeof enabled!=='boolean')throw Error('Ongeldige instelling');const {value,revision}=await read('reisschema-control');await write('reisschema-control',{...value,enabled,...(enabled&&!value.enabled&&dailyControlDue(clock())?{lastScheduledDay:dayAt(clock())}:{})},revision);}};
}
