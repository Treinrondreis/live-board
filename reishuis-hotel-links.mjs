import {createHash} from 'node:crypto';
import {mergeDossier} from './reishuis-dossier.mjs';

const name=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases=h=>[h.title,h.titleShort].map(name).filter(Boolean);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v.slice(0,10)))&&new Date(v.slice(0,10)).toISOString().slice(0,10)===v.slice(0,10)?v.slice(0,10):'';
const months=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
function titleParts(title){
 let s=String(title||'').trim(),prefix='';
 const m=s.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+[a-zA-Z]+\.?\s*(?:\d{4})?)\s*:\s*/);
 if(m){prefix=m[1];s=s.slice(m[0].length);}
 return {prefix,parts:s.split(/\s*\|\s*|\s+-\s+/).map(name).filter(Boolean)};
}
function prefixDay(prefix,start){
 if(!prefix)return '';
 if(/^\d{4}-/.test(prefix))return date(prefix);
 const numeric=prefix.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
 if(numeric)return date(numeric[3]+'-'+numeric[2].padStart(2,'0')+'-'+numeric[1].padStart(2,'0'));
 const m=prefix.match(/^(\d{1,2})\s+([a-zA-Z]+)\.?\s*(\d{4})?$/);if(!m)return '';
 const month=months.indexOf(m[2].toLowerCase().slice(0,3).replace(/^maa$/,'mrt'));if(month<0)return '';
 return date((m[3]||start.slice(0,4))+'-'+String(month+1).padStart(2,'0')+'-'+m[1].padStart(2,'0'));
}
function hotelResolver(hotels){
 const index=new Map();for(const h of hotels)for(const alias of aliases(h)){if(!index.has(alias))index.set(alias,new Set());index.get(alias).add(h);}
 return title=>{const parts=titleParts(title).parts;for(let i=parts.length;i>0;i--){const found=index.get(parts.slice(0,i).join(' '));if(found)return [...found];}return [];};
}
export function hotelsForTitle(title,hotels){return hotelResolver(hotels)(title);}
function roomForTitle(title,hotel){const parts=titleParts(title).parts.slice(1);const matches=hotel.rooms.filter(r=>aliases(r).some(a=>parts.includes(a)));return matches.length===1?matches[0]:null;}

// Only unique source keys are indexable. Never guess identities for legacy keyless rows.
export function hotelTodoIndex(todos){const list=Array.isArray(todos)?todos:[];return list.filter(t=>typeof t._key==='string'&&list.filter(r=>r._key===t._key).length===1).map(t=>({id:'source-'+createHash('sha256').update(JSON.stringify(['todo',t._key,0])).digest('hex').slice(0,32),title:typeof t.title==='string'?t.title:'',startDate:date(t.startDate),endDate:date(t.endDate),quantity:typeof t.quantity==='number'&&Number.isFinite(t.quantity)?t.quantity:null,tag:'hotel'}));}

export function hotelMatches(dossier,hotels,components={}){
 const resolve=hotelResolver(hotels),results={},todos=dossier.todos.filter(t=>!t.review&&!t.archived&&!t.sourceRemoved),claims=new Map();for(const [id,c] of Object.entries(components))if(c.line)claims.set(c.line,[...(claims.get(c.line)||[]),id]);
 for(const t of todos){
  if(t.component){if(!(claims.get(t.component.line)||[]).includes(t.id))claims.set(t.component.line,[...(claims.get(t.component.line)||[]),t.id]);continue;}
  if(t.tag!=='hotel')continue;
  const found=resolve(t.title);if(found.length!==1){results[t.id]={reason:found.length?'Meerdere hotels passen bij deze naam.':'Hotelnaam niet eenduidig herkend.'};continue;}
  const h=found[0],room=roomForTitle(t.title,h),start=date(t.startDate),end=date(t.endDate),result={hotel:h.id,room:room?.key||'',reason:'Geen eenduidige financiële regel met dezelfde hotelnaam en datum.'};results[t.id]=result;
  if(!start||!end||end<=start)continue;
  let lines=dossier.lines.filter(l=>!l.sourceRemoved&&l.type==='product'&&resolve(l.title).length===1&&resolve(l.title)[0].id===h.id).filter(l=>{
   const explicit=date(l.date),from=date(l.startDate),to=date(l.endDate),prefix=prefixDay(titleParts(l.title).prefix,start),known=[explicit,from,prefix].filter(Boolean);
   return known.length>0&&known.every(d=>d===start)&&(!to||to===end);
  });
  if(room){const exact=lines.filter(l=>roomForTitle(l.title,h)?.key===room.key);if(exact.length)lines=exact;else lines=lines.filter(l=>!roomForTitle(l.title,h));}
  if(lines.length!==1)continue;
  const l=lines[0];result.component={kind:'hotel',line:l.id,hotel:h.id,room:room?.key||'',checkin:start,checkout:end,rooms:Number.isInteger(t.quantity)&&t.quantity>0?t.quantity:null};
  claims.set(l.id,[...(claims.get(l.id)||[]),t.id]);
 }
 for(const result of Object.values(results))if(result.component){if(claims.get(result.component.line)?.length!==1){delete result.component;result.reason='Deze financiële regel past bij meerdere taken; controleer de koppeling.';}else result.reason='Automatisch herkend op hotelnaam en datum.';}
 return results;
}

export function hotelStays(bookings,state,hotels,id,today,period='upcoming',page=0){
 const stays=[],resolve=hotelResolver(hotels),byId=new Map(hotels.map(h=>[h.id,h]));let uncertain=0;
 for(const b of bookings){
  const local=state.dossiers?.[b.id]||{},source={todos:b.hotelTodos||[],lines:[],personal:{}},dossier=mergeDossier(source,local);
  for(const t of dossier.todos.filter(t=>!t.review&&!t.archived)){
   // A source removal with local edits remains visible for an operator to check.
   const c=t.component;if(c&&c.kind!=='hotel')continue;
   const found=c?.hotel?(byId.has(c.hotel)?[byId.get(c.hotel)]:[]):t.tag==='hotel'?resolve(t.title):[];
   if(found.length!==1){if(found.some(h=>h.id===id))uncertain++;continue;}if(found[0].id!==id)continue;
   const checkin=date(c?.checkin||t.startDate),checkout=date(c?.checkout||t.endDate),rooms=c?.rooms??t.quantity;
   const cancelled=/^(geannuleerd|geannuleerd door klant|cancelled|canceled)$/.test(b.status),past=!!checkout&&checkout<=today;
   if(period==='cancelled'){if(!cancelled)continue;}else if(cancelled||(period==='past'?!past:past))continue;
   stays.push({todo:t.id,booking:b.id,index:b.index,name:b.name,checkin,checkout,rooms:Number.isInteger(rooms)&&rooms>0?rooms:null,room:t.title.split('|').slice(1).join(' | ').trim(),status:b.status,needsReview:!!t.sourceRemoved||!checkin||!checkout||checkout<=checkin||!Number.isInteger(rooms)||rooms<1});
  }
 }
 stays.sort((a,b)=>(a.checkin||'9999').localeCompare(b.checkin||'9999')||a.index.localeCompare(b.index)||a.todo.localeCompare(b.todo));
 const total=stays.length,pages=Math.max(1,Math.ceil(total/25)),current=Math.min(page,pages-1);return {stays:stays.slice(current*25,current*25+25),total,page:current,pages,uncertain};
}
