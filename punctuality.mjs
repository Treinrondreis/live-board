import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const norm=v=>String(v||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const digits=v=>(String(v||'').match(/\d+[a-z]?$/i)?.[0]?.toUpperCase()||'').replace(/^0+(?=\d)/,'');
const stamp=v=>typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>=946684800000&&Number(v)<=8640000000000000?Number(v):null;
const local=value=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value).map(p=>[p.type,p.value]));
export function punctualityRow(t,source,at){
 const planned=stamp(t.plannedTimestamp),actual=stamp(t.actualTimestamp),expected=t.hasRealtime===true?stamp(t.expectedTimestamp):null;
 const mode=t.eventMode||t.mode,station=t.observedAt||t.station,number=digits(t.number||t.trainNumber);
 if(!planned||!station||!number||!['arrival','departure'].includes(mode)||!stamp(at)||actual&&actual>at+60000||!actual&&!expected&&t.cancelled!==true)return null;
 const kind=actual?'actual':'expected',value=actual||expected;
 return {source:String(source),train_number:number,category:String(t.category||''),station:String(station),event_mode:mode,planned_at:planned,expected_at:expected,actual_at:actual,delay_minutes:value?Math.round((value-planned)/60000):null,cancelled:t.cancelled===true,kind,first_seen_at:at,last_seen_at:at,source_timestamp:stamp(t.messageTimestamp)||at};
}
export function punctualityLegMatches(row,leg){
 if(leg.status!=='active'||!leg.leg_id||!leg.version_id)return false;
 const numbers=[leg.train_number,leg.observation?.train_number].map(digits).filter(Boolean);
 if(!numbers.includes(row.train_number))return false;
 const arrival=row.event_mode==='arrival',station=arrival?leg.to_station:leg.from_station;
 if(norm(station)!==norm(row.station))return false;
 const p=local(row.planned_at),day=`${p.year}-${p.month}-${p.day}`,time=`${p.hour}:${p.minute}`;
 const expectedDay=arrival?(leg.arrival_date||leg.travel_date):leg.travel_date;
 const observedDay=leg.observation?.[(arrival?'arrival':'departure')+'_date'];
 const baselines=[day===expectedDay?leg[(arrival?'arrival':'departure')+'_time']:null,day===observedDay?leg.observation?.[(arrival?'arrival':'departure')+'_time']:null].filter(Boolean);
 // The event's actual calendar date is decisive, also for overnight arrivals.
 return baselines.some(v=>Math.abs(Date.parse(day+'T'+v+':00Z')-Date.parse(day+'T'+time+':00Z'))<=30*60000);
}
const schema=`CREATE TABLE IF NOT EXISTS punctuality_events (
 event_id TEXT PRIMARY KEY,identity_key TEXT NOT NULL,state_hash TEXT NOT NULL,train_number TEXT NOT NULL,planned_at BIGINT NOT NULL,
 first_seen_at BIGINT NOT NULL,last_seen_at BIGINT NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS punctuality_event_identity ON punctuality_events(identity_key,last_seen_at);
 CREATE INDEX IF NOT EXISTS punctuality_train_date ON punctuality_events(train_number,planned_at);
 CREATE TABLE IF NOT EXISTS punctuality_current (
 identity_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,state_hash TEXT NOT NULL,last_seen_at BIGINT NOT NULL);
 CREATE TABLE IF NOT EXISTS punctuality_legs (
 leg_id TEXT NOT NULL,version_id TEXT NOT NULL,event_id TEXT NOT NULL,event_mode TEXT NOT NULL,
 PRIMARY KEY(leg_id,event_id));
 CREATE INDEX IF NOT EXISTS punctuality_leg_lookup ON punctuality_legs(leg_id,event_mode);`;
export function createPunctualityArchive(db,options={}){
 let {getLegs=async()=>({available:false,legs:[]}),screenMatch=()=>false,clock=Date.now}=options;
 let selection={available:false,legs:[]},until=0,queue=Promise.resolve(),linkedLegs=new Map();
 const status={ready:false,error:null,lastWrite:null,registerAvailable:false};
 const query=async(sql,args=[])=>db.pool?(await db.pool.query(sql,args)).rows:db.sqlite.prepare(sql.replace(/\$\d+/g,'?')).all(...args);
 async function refresh(){
  if(clock()<until)return;until=clock()+30000;try{const result=await getLegs();selection=result.available?result:{available:false,legs:[]};}catch{selection={available:false,legs:[]};}status.registerAvailable=selection.available;
  if(!selection.available){linkedLegs.clear();return;}
  linkedLegs=new Map([...linkedLegs].filter(([id])=>selection.legs.some(l=>l.leg_id===id)));
  const signature=l=>hash([l.version_id,l.train_number,l.observation?.train_number,l.from_station,l.to_station,l.travel_date,l.arrival_date,l.departure_time,l.arrival_time]);
  const reused=new Map();
  for(const leg of selection.legs.filter(l=>l.status==='active'&&linkedLegs.get(l.leg_id)!==signature(l))){
   const numbers=[...new Set([leg.train_number,leg.observation?.train_number].map(digits).filter(Boolean))];if(!numbers.length)continue;
   const start=Date.parse(leg.travel_date)-86400000,end=Date.parse(leg.arrival_date||leg.travel_date)+2*86400000,key=JSON.stringify([numbers,start,end]);
   if(!reused.has(key))reused.set(key,await query('SELECT event_id,payload FROM punctuality_events WHERE train_number IN ('+numbers.map((_,i)=>'$'+(i+1)).join(',')+') AND planned_at>=$'+(numbers.length+1)+' AND planned_at<$'+(numbers.length+2),[...numbers,start,end]));
   for(const event of reused.get(key)){const row=JSON.parse(event.payload);if(!punctualityLegMatches(row,leg))continue;
    const sql='INSERT INTO punctuality_legs(leg_id,version_id,event_id,event_mode) VALUES($1,$2,$3,$4) ON CONFLICT(leg_id,event_id) DO NOTHING',args=[leg.leg_id,leg.version_id,event.event_id,row.event_mode];
    if(db.pool)await db.pool.query(sql,args);else db.sqlite.prepare(sql.replace(/\$\d+/g,'?')).run(...args);
   }linkedLegs.set(leg.leg_id,signature(leg));
  }
 }
 async function write(trains,source,at){
  if(!status.ready)return;await refresh();const rows=[];
  for(const train of trains){const row=punctualityRow(train,source,at);if(!row)continue;
   const links=selection.legs.filter(leg=>punctualityLegMatches(row,leg));
   if(!links.length&&!screenMatch({...train,source}))continue;
   rows.push({row,links});
  }
  // Bounded batches, compact changed states only; no raw board payloads or customer names.
  for(let offset=0;offset<rows.length;offset+=200){
   const batch=rows.slice(offset,offset+200),keys=batch.map(({row:r})=>hash([r.source,r.train_number,norm(r.station),r.event_mode,r.planned_at,r.kind]));
   const prior=new Map((await query('SELECT * FROM punctuality_current WHERE identity_key IN ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys)).map(r=>[r.identity_key,r]));
   const commands=[];
   batch.forEach(({row:r,links},i)=>{
    const identity=keys[i],stateHash=hash([r.expected_at,r.actual_at,r.cancelled]),old=prior.get(identity),id=old?.state_hash===stateHash?old.event_id:hash([identity,stateHash,at]);
    commands.push(['INSERT INTO punctuality_events(event_id,identity_key,state_hash,train_number,planned_at,first_seen_at,last_seen_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_id) DO UPDATE SET first_seen_at=CASE WHEN punctuality_events.first_seen_at>excluded.first_seen_at THEN excluded.first_seen_at ELSE punctuality_events.first_seen_at END,last_seen_at=CASE WHEN punctuality_events.last_seen_at<excluded.last_seen_at THEN excluded.last_seen_at ELSE punctuality_events.last_seen_at END',[id,identity,stateHash,r.train_number,r.planned_at,at,at,JSON.stringify(r)]]);
    commands.push(['INSERT INTO punctuality_current(identity_key,event_id,state_hash,last_seen_at) VALUES($1,$2,$3,$4) ON CONFLICT(identity_key) DO UPDATE SET event_id=excluded.event_id,state_hash=excluded.state_hash,last_seen_at=excluded.last_seen_at WHERE punctuality_current.last_seen_at<=excluded.last_seen_at',[identity,id,stateHash,at]]);
    for(const leg of links)commands.push(['INSERT INTO punctuality_legs(leg_id,version_id,event_id,event_mode) VALUES($1,$2,$3,$4) ON CONFLICT(leg_id,event_id) DO NOTHING',[leg.leg_id,leg.version_id,id,r.event_mode]]);
    if(!old||Number(old.last_seen_at)<=at)prior.set(identity,{event_id:id,state_hash:stateHash,last_seen_at:at});
   });
   if(db.pool){const client=await db.pool.connect();try{await client.query('BEGIN');for(const [sql,args] of commands)await client.query(sql,args);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
   else{db.sqlite.exec('BEGIN IMMEDIATE');try{for(const [sql,args] of commands)db.sqlite.prepare(sql.replace(/\$\d+/g,'?')).run(...args);db.sqlite.exec('COMMIT');}catch(e){db.sqlite.exec('ROLLBACK');throw e;}}
  }
  if(rows.length){status.lastWrite=Math.max(status.lastWrite||0,at);status.error=null;}
 }
 const api={
  configure(next){getLegs=next.getLegs||getLegs;screenMatch=next.screenMatch||screenMatch;until=0;},
  async init(){if(db.pool)await db.pool.query(schema);else db.sqlite.exec(schema);status.ready=true;},
  record(trains,source,at=clock()){const task=queue.then(()=>write(trains,source,at));queue=task.catch(()=>{status.error='Stiptheidsopslag niet voltooid; controleer de opslag.';});return task;},
  status:()=>({...status,retention:'permanent',changesOnly:true}),
  async history(legId,limit=500){if(!status.ready)return [];const rows=await query('SELECT e.* FROM punctuality_events e JOIN punctuality_legs l ON e.event_id=l.event_id WHERE l.leg_id=$1 ORDER BY e.last_seen_at DESC,e.event_id LIMIT $2',[legId,limit]);return rows.map(r=>({...JSON.parse(r.payload),first_seen_at:Number(r.first_seen_at),last_seen_at:Number(r.last_seen_at)}));},
  async enrich(legs){
   if(!status.ready)return legs;
   const latest=new Map(),ids=[...new Set(legs.map(l=>l.leg_id).filter(Boolean))];
   for(let offset=0;offset<ids.length;offset+=200){
    const batch=ids.slice(offset,offset+200),kind=db.pool?"e.payload::jsonb->>'kind'":"json_extract(e.payload,'$.kind')";
    const rows=await query('SELECT * FROM (SELECT l.leg_id,l.event_mode,e.payload,e.first_seen_at,e.last_seen_at,ROW_NUMBER() OVER (PARTITION BY l.leg_id,l.event_mode ORDER BY CASE WHEN '+kind+"='actual' THEN 0 ELSE 1 END,e.last_seen_at DESC,e.event_id) AS rank FROM punctuality_legs l JOIN punctuality_events e ON e.event_id=l.event_id WHERE l.leg_id IN ("+batch.map((_,i)=>'$'+(i+1)).join(',')+')) ranked WHERE rank=1',batch);
    for(const row of rows){if(!latest.has(row.leg_id))latest.set(row.leg_id,{});latest.get(row.leg_id)[row.event_mode]={...JSON.parse(row.payload),first_seen_at:Number(row.first_seen_at),last_seen_at:Number(row.last_seen_at)};}
   }
   return legs.map(leg=>({...leg,punctuality:latest.get(leg.leg_id)||{}}));
  }
 };return api;
}
let instance=null,settings={},database=null;
const backfill={running:false,completed:false,error:null};
export function configurePunctuality(options){settings=options;instance?.configure(options);}
export async function initPunctuality(db){database=db;instance=createPunctualityArchive(db,settings);await instance.init();}
export const recordPunctuality=(...args)=>instance?.record(...args)||Promise.resolve();
export const enrichPunctuality=rows=>instance?.enrich(rows)||Promise.resolve(rows);
export const punctualityHistory=id=>instance?.history(id)||Promise.resolve([]);
export const punctualityStatus=()=>({...instance?.status(),ready:!!instance?.status().ready,backfill:{...backfill}});
export async function backfillPunctuality(now=Date.now()){
 if(!database||!instance||backfill.running)return;backfill.running=true;backfill.error=null;let cursor=0;const cutoff=now-31*86400000;
 const query=async(sql,args)=>database.pool?(await database.pool.query(sql,args)).rows:database.sqlite.prepare(sql.replace(/\$\d+/g,'?')).all(...args);
 try{while(true){const rows=await query('SELECT id,source,train_number,category,station,event_mode,observed_at,planned_timestamp,expected_timestamp,delay_minutes,cancelled FROM train_observations WHERE id>$1 AND observed_at>=$2 AND (delay_minutes<>0 OR cancelled=TRUE) ORDER BY id LIMIT 200',[cursor,cutoff]);if(!rows.length)break;
   const groups=new Map();for(const r of rows){const key=JSON.stringify([r.source,Number(r.observed_at)]);if(!groups.has(key))groups.set(key,{source:r.source,at:Number(r.observed_at),trains:[]});groups.get(key).trains.push({number:r.train_number,category:r.category,observedAt:r.station,eventMode:r.event_mode,plannedTimestamp:Number(r.planned_timestamp),expectedTimestamp:Number(r.expected_timestamp)||(Number(r.planned_timestamp)?Number(r.planned_timestamp)+Number(r.delay_minutes)*60000:null),hasRealtime:Number(r.delay_minutes)!==0,cancelled:!!r.cancelled});}
   for(const group of groups.values())await recordPunctuality(group.trains,group.source,group.at);
   cursor=Number(rows.at(-1).id);await new Promise(resolve=>setTimeout(resolve,10));
  }backfill.completed=true;}catch{backfill.error='Bestaande bordmetingen nog niet volledig overgenomen.';}finally{backfill.running=false;}
}
export function snapshotPunctualityRows(snapshot){return (snapshot.stops||[]).flatMap(stop=>['arrival','departure'].flatMap(mode=>{const e=stop[mode];if(!e)return [];return [{number:snapshot.trainNumber,category:snapshot.category,observedAt:stop.station,eventMode:mode,plannedTimestamp:e.plannedTime??e.measurementPlannedTime,expectedTimestamp:e.expectedTime,actualTimestamp:e.realizationConfirmed===true?e.actualTime:null,hasRealtime:e.realtime===true||e.measurementOnly===true,cancelled:e.cancelled===true,messageTimestamp:snapshot.sourceTimestamp}];}));}
