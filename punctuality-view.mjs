const stamp=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function punctualityView(row,mode){
 const value=row.punctuality?.[mode];if(!value)return null;
 const actual=value.kind==='actual'?stamp(value.actual_at):null,expected=stamp(value.expected_at),at=actual||expected;
 const fmt=time=>time?new Date(time).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}):'';
 const delta=at&&stamp(value.planned_at)?Math.round((at-Number(value.planned_at))/60000):null;
 return {delay:delta,label:delta>0?'+'+delta:delta<0?String(delta):'',time:fmt(at),planned:fmt(value.planned_at),kind:actual?'Werkelijk':'Verwacht',source:value.source,observedAt:value.last_seen_at,cancelled:value.cancelled===true};
}
