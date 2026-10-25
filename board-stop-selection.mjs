// Display selection only: collection and permanent measurements remain complete.
const stamp=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;
const station=row=>String(row.observedAt||row.station||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const freshness=row=>stamp(row.messageTimestamp)||stamp(row.measuredAt)||stamp(row.updatedAt);
const time=row=>stamp(row.hasRealtime===false?row.plannedTimestamp:row.expectedTimestamp)||stamp(row.plannedTimestamp);
export function chooseNextBoardStop(items,now=Date.now()){
 return [...items].sort((a,b)=>{
  const at=time(a),bt=time(b),af=at>=now,bf=bt>=now;
  if(af!==bf)return af?-1:1;
  if(at!==bt)return af?at-bt:bt-at;
  return Number(!!b.hasRealtime)-Number(!!a.hasRealtime)||freshness(b)-freshness(a);
 })[0];
}
export function selectBoardStops(items,now=Date.now()){
 // Resolve conflicting providers for the very same stop event before deciding
 // whether this is a partial cancellation at different stations.
 const points=new Map();
 for(const row of items){
  const key=[station(row),row.eventMode,stamp(row.plannedTimestamp)].join('|'),old=points.get(key);
  if(!old||freshness(row)>freshness(old)||freshness(row)===freshness(old)&&!old.hasRealtime&&row.hasRealtime)points.set(key,row);
 }
 const rows=[...points.values()],active=rows.filter(r=>!r.cancelled),cancelled=rows.filter(r=>r.cancelled);
 const main=chooseNextBoardStop(active.length?active:cancelled,now);if(!main)return [];
 if(!active.length)return [main];
 const other=chooseNextBoardStop(cancelled.filter(r=>station(r)!==station(main)),now);
 return other?[main,other]:[main];
}
