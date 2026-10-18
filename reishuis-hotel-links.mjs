import {hotelNight} from './reishuis-hotel-pricing.mjs';
import {createHash} from 'node:crypto';
import {mergeDossier} from './reishuis-dossier.mjs';

const name=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const aliases=h=>[h.title,h.titleShort].map(name).filter(Boolean);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v.slice(0,10)))&&new Date(v.slice(0,10)).toISOString().slice(0,10)===v.slice(0,10)?v.slice(0,10):'';
const months=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
const dateToken=String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}\s+[a-zA-Z]+\.?(?:\s+\d{4})?)`;
const invoicePrefix=new RegExp('^('+dateToken+')(?:\\s+[-–—]\\s+('+dateToken+'))?\\s*:\\s*');
function titleParts(title){
 let s=String(title||'').trim(),prefix='',endPrefix='';
 const m=s.match(invoicePrefix);if(m){prefix=m[1];endPrefix=m[2]||'';s=s.slice(m[0].length);}
 return {prefix,endPrefix,parts:s.split(/\s*\|\s*|\s+-\s+/).map(name).filter(Boolean)};
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
function roomForTitle(title,hotel){
 const parts=titleParts(title).parts.slice(1).flatMap(p=>{const value=p.replace(/^\d+\s*x\s+/,''),withoutBoard=value.replace(/\s+(?:incl|inclusief|excl|exclusief|zonder|met)\s+(?:ontbijt|breakfast)$/,'');return [value,withoutBoard];});
 const matches=hotel.rooms.filter(r=>aliases(r).some(a=>parts.includes(a)));return matches.length===1?matches[0]:null;
}

// Only unique source keys are indexable. Never guess identities for legacy keyless rows.
export function hotelTodoIndex(todos){const list=Array.isArray(todos)?todos:[];return list.filter(t=>typeof t._key==='string'&&list.filter(r=>r._key===t._key).length===1).map(t=>({id:'source-'+createHash('sha256').update(JSON.stringify(['todo',t._key,0])).digest('hex').slice(0,32),title:typeof t.title==='string'?t.title:'',startDate:date(t.startDate),endDate:date(t.endDate),quantity:typeof t.quantity==='number'&&Number.isFinite(t.quantity)?t.quantity:null,tag:'hotel',supplierBookingNumber:typeof t.supplierBookingNumber==='string'?t.supplierBookingNumber:''}));}

export function hotelRateChoice(component,hotels){
 if(!component||component.kind!=='hotel'||Object.hasOwn(component,'provider')&&Object.hasOwn(component,'board'))return component;
 const room=hotels.find(h=>h.id===component.hotel)?.rooms.find(r=>r.key===component.room),ref=room?.apoRoom,rate=hotels.find(h=>h.id===ref?.docId)?.apoRooms?.find(r=>'apoRooms.'+r.key===ref?.path),choices=[...new Map((rate?.prices||[]).map(p=>[JSON.stringify([p.source||'',p.boardType||'']),{provider:p.source||'',board:p.boardType||''}])).values()].filter(choice=>(!Object.hasOwn(component,'provider')||component.provider===choice.provider)&&(!Object.hasOwn(component,'board')||component.board===choice.board));
 return choices.length===1?{...component,...choices[0]}:component;
}

export function hotelMatches(dossier,hotels,components={},original,resolve=hotelResolver(hotels)){
 const results={},todos=dossier.todos.filter(t=>!t.review&&!t.archived&&!t.sourceRemoved),claims=new Map();for(const [id,c] of Object.entries(components))if(c.line)claims.set(c.line,[...(claims.get(c.line)||[]),id]);
 for(const t of todos){
  if(t.component){if(!(claims.get(t.component.line)||[]).includes(t.id))claims.set(t.component.line,[...(claims.get(t.component.line)||[]),t.id]);continue;}
  if(t.tag!=='hotel')continue;
  const originalTodo=original?.todos.find(r=>r.id===t.id&&r.tag==='hotel'&&name(r.title)===name(t.title)),anchor=originalTodo||t;
  const found=resolve(anchor.title);if(found.length!==1){results[t.id]={reason:found.length?'Meerdere hotels passen bij deze naam.':'Hotelnaam niet eenduidig herkend.'};continue;}
  const h=found[0],room=roomForTitle(t.title,h),start=date(anchor.startDate),end=date(anchor.endDate),result={hotel:h.id,room:room?.key||'',reason:'Geen eenduidige financiële regel met dezelfde hotelnaam en datum.'};results[t.id]=result;
  if(!start||!end||end<=start)continue;
  let lines=dossier.lines.filter(l=>!l.sourceRemoved&&l.type==='product'&&resolve(l.title).length===1&&resolve(l.title)[0].id===h.id).filter(l=>{
   const parts=titleParts(l.title),explicit=date(l.date),from=date(l.startDate),to=date(l.endDate),prefix=prefixDay(parts.prefix,start),until=prefixDay(parts.endPrefix,end),known=[explicit,from,prefix].filter(Boolean),ends=[to,until].filter(Boolean);
   return (!parts.prefix||!!prefix)&&(!parts.endPrefix||!!until)&&known.length>0&&known.every(d=>d===start)&&ends.every(d=>d===end);
  });
  if(room){const exact=lines.filter(l=>roomForTitle(l.title,h)?.key===room.key);if(exact.length)lines=exact;else lines=lines.filter(l=>!roomForTitle(l.title,h));}
  if(lines.length!==1)continue;
  const l=lines[0];result.component=hotelRateChoice({kind:'hotel',line:l.id,hotel:h.id,room:room?.key||'',checkin:date(t.startDate)||start,checkout:date(t.endDate)||end,rooms:Number.isInteger(t.quantity)&&t.quantity>0?t.quantity:null},hotels);
  claims.set(l.id,[...(claims.get(l.id)||[]),t.id]);
 }
 for(const result of Object.values(results))if(result.component){if(claims.get(result.component.line)?.length!==1){delete result.component;result.reason='Deze financiële regel past bij meerdere taken; controleer de koppeling.';}else result.reason='Automatisch herkend op hotelnaam en datum.';}
 return results;
}

// Only stable unique source keys may bind to local financial overrides.
export function hotelFinancialIndex(lines){
 const list=Array.isArray(lines)?lines:[],num=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()&&Number.isFinite(Number(v))?Number(v):null;
 return list.filter(l=>typeof l._key==='string'&&list.filter(r=>r._key===l._key).length===1).map(l=>({id:'source-'+createHash('sha256').update(JSON.stringify(['line',l._key,0])).digest('hex').slice(0,32),title:typeof l.title==='string'?l.title:'',date:date(l.date),quantity:num(l.quantity??l.amount??1),price:num(l.price),costs:num(l.costs),type:['product','discount','margin','option'].includes(l.type)?l.type:'product'}));
}
const lineTotal=(line,field)=>{if(!line||line.sourceRemoved||typeof line.quantity!=='number'||!Number.isFinite(line.quantity)||typeof line[field]!=='number'||!Number.isFinite(line[field]))return null;const value=Math.round(line.quantity*line[field]*100)/100;return Number.isFinite(value)?value:null;};
function currentStayPrice(c,hotels){
 if(!c)return {price:null,reason:'Hotel, kamer en financiële regel nog niet eenduidig gekoppeld.'};
 const h=hotels.find(h=>h.id===c.hotel),room=h?.rooms.find(r=>r.key===c.room),start=date(c.checkin),end=date(c.checkout),nights=(Date.parse(end)-Date.parse(start))/86400000;
 if(!room||!start||!end||!Number.isInteger(nights)||nights<1||nights>366||!Number.isInteger(c.rooms)||c.rooms<1||c.rooms>100)return {price:null,reason:'Controleer kamer, datums en aantal kamers.'};
 let amount=0;const sources=new Set();for(let i=0;i<nights;i++){const d=new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10),r=hotelNight(h,room,d,hotels,c);if(r.missing)return {price:null,reason:r.missing};amount+=Math.round(r.price*100)*c.rooms;sources.add(r.source||'APO');}return {price:amount/100,source:[...sources].join(' / ')};
}
export function hotelStays(bookings,state,hotels,id,today,period='upcoming',page=0){
 const stays=[],resolve=hotelResolver(hotels),byId=new Map(hotels.map(h=>[h.id,h]));let uncertain=0;
 for(const b of bookings){
  const local=state.dossiers?.[b.id]||{},source={todos:b.hotelTodos||[],lines:b.hotelFinancialLines||[],personal:{}},dossier=mergeDossier(source,local),active=dossier.todos.filter(t=>!t.review&&!t.archived);
  if(!active.some(t=>t.component?.hotel===id||!t.component&&t.tag==='hotel'&&resolve(t.title).some(h=>h.id===id)))continue;
  const automatic=hotelMatches(dossier,hotels,local.components,source,resolve),claims=new Map();for(const t of active){const c=t.component||automatic[t.id]?.component;if(c?.line)claims.set(c.line,(claims.get(c.line)||0)+1);}
  for(const t of active){
   const c=hotelRateChoice(t.component||automatic[t.id]?.component,hotels);if(c&&c.kind!=='hotel')continue;
   const found=c?.hotel?(byId.has(c.hotel)?[byId.get(c.hotel)]:[]):t.tag==='hotel'?resolve(t.title):[];
   if(found.length!==1){if(found.some(h=>h.id===id))uncertain++;continue;}if(found[0].id!==id)continue;
   const checkin=date(c?.checkin||t.startDate),checkout=date(c?.checkout||t.endDate),rooms=c?.rooms??t.quantity;
   const cancelled=/^(geannuleerd|geannuleerd door klant|cancelled|canceled)$/.test(b.status),past=!!checkout&&checkout<=today;
   if(period==='cancelled'){if(!cancelled)continue;}else if(cancelled||(period==='past'?!past:past))continue;
   const unique=!!c?.line&&claims.get(c.line)===1,line=unique?dossier.lines.find(l=>l.id===c.line):null,current=unique?currentStayPrice(c,hotels):{price:null,reason:'Financiële koppeling ontbreekt of is dubbelzinnig.'},nightCount=checkin&&checkout?(Date.parse(checkout)-Date.parse(checkin))/86400000:null;
   stays.push({todo:t.id,booking:b.id,index:b.index,name:b.name,checkin,checkout,rooms:Number.isInteger(rooms)&&rooms>0?rooms:null,room:byId.get(id)?.rooms.find(r=>r.key===c?.room)?.title||t.title.split('|').slice(1).join(' | ').trim(),status:b.status,calculated:lineTotal(line,'price'),actual:lineTotal(line,'costs'),current:current.price,priceReason:current.reason||'',provider:current.source||(byId.get(id)?.bookingPriceSource==='cms'?'Contract':c?.provider||''),supplierBookingNumber:t.supplierBookingNumber||'',roomNights:Number.isInteger(nightCount)&&nightCount>0&&Number.isInteger(rooms)&&rooms>0?nightCount*rooms:null,needsReview:!!t.sourceRemoved||!checkin||!checkout||checkout<=checkin||!Number.isInteger(rooms)||rooms<1||!unique});
  }
 }
 stays.sort((a,b)=>(a.checkin||'9999').localeCompare(b.checkin||'9999')||a.index.localeCompare(b.index)||a.todo.localeCompare(b.todo));
 const summarize=list=>{const actual=list.filter(r=>r.actual!==null&&r.roomNights),knownNights=actual.reduce((n,r)=>n+r.roomNights,0);return {bookings:new Set(list.map(r=>r.booking)).size,stays:list.length,rooms:list.some(r=>r.rooms===null)?null:list.reduce((n,r)=>n+r.rooms,0),roomNights:list.some(r=>r.roomNights===null)?null:list.reduce((n,r)=>n+r.roomNights,0),averageActual:knownNights?Math.round(actual.reduce((n,r)=>n+Math.round(r.actual*100),0)/knownNights)/100:null,actualMissing:list.filter(r=>r.actual===null).length};};
 const months={};for(const r of stays){const month=r.checkin?.slice(0,7)||'unknown';if(!months[month])months[month]=[];months[month].push(r);}for(const month of Object.keys(months))months[month]=summarize(months[month]);
 const total=stays.length,pages=Math.max(1,Math.ceil(total/25)),current=Math.min(page,pages-1);return {stays:stays.slice(current*25,current*25+25),total,page:current,pages,uncertain,summary:summarize(stays),months};
}
