import {randomUUID,createHash} from 'node:crypto';
import {mergeDossier} from './reishuis-dossier.mjs';
const fail=message=>{const e=Error(message);e.status=400;e.reishuisSafe=true;throw e;};
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=10000000;
const cents=v=>Math.round(v*100),money=v=>cents(v)/100;
const clean=v=>{if(typeof v!=='string'||v.length>500||v.includes('\0'))fail('Controleer de tekst.');return v.trim();};
const key=(v,message='Ongeldige koppeling.')=>{if(typeof v!=='string'||!/^[-a-zA-Z0-9_.:]{1,200}$/.test(v)||['__proto__','constructor','prototype'].includes(v))fail(message);return v;};
export function day(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Controleer de reisdatums.');return v;}
export const shiftDay=(v,n)=>v?new Date(Date.parse(day(v))+n*86400000).toISOString().slice(0,10):'';
const count=(v,max=100)=>{if(!Number.isInteger(v)||v<1||v>max)fail('Controleer het aantal.');return v;};
const total=l=>finite(l?.price)&&finite(l?.quantity)?money(l.price*l.quantity):null;
export function hotelAmount(c,hotels){
 const hotel=hotels.find(h=>h.id===c.hotel),room=hotel?.rooms.find(r=>r.key===c.room);if(!hotel||!room)return {missing:'Kies een hotel en kamer.'};
 const link=room.apoRoom,rate=link&&hotels.find(h=>h.id===link.docId)?.apoRooms.find(r=>'apoRooms.'+r.key===link.path);if(!rate)return {missing:'Geen APO-koppeling voor deze kamer. Vul het totaal handmatig in.'};
 const start=day(c.checkin),end=day(c.checkout),nights=(Date.parse(end)-Date.parse(start))/86400000;count(nights,366);count(c.rooms);let amount=0;const nightsUsed=[];
 for(let i=0;i<nights;i++){const date=shiftDay(start,i),matches=rate.prices.filter(p=>p.date.slice(0,10)===date&&p.boardType===c.board&&p.source===c.provider&&finite(p.price)&&p.price>=0);if(matches.length!==1)return {missing:'Geen eenduidig tarief op '+date+'. Vul het totaal handmatig in.'};if(cents(matches[0].price)<=0)return {missing:'Niet beschikbaar voor deze datum: '+date+'. Toch wijzigen? Vul zelf een tarief in en controleer de beschikbaarheid.',unavailable:true,date};amount+=cents(matches[0].price)*c.rooms;nightsUsed.push({date,price:matches[0].price,source:matches[0].source,lastUpdate:matches[0].lastUpdate});}
 if(amount>1000000000)fail('Het totaal is te groot.');return {amount:amount/100,nights:nightsUsed};
}
export function interrailAmount(c,passes){const pass=passes.find(p=>p.id===c.pass),variants=pass?.variants.filter(v=>v.class===c.class&&v.ageGroup===c.ageGroup)||[];count(c.count);if(!pass||variants.length!==1)return {missing:'Geen eenduidig Interrail-tarief. Controleer pas, klasse en doelgroep.'};return {amount:money(variants[0].price*c.count),unitPrice:variants[0].price};}
export function quoteChange(source,local,input,catalogs){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['todo','kind','line','title','mode','amount','hotel','room','board','provider','checkin','checkout','rooms','pass','class','ageGroup','count','startDate','endDate','shiftIds','manualAmounts','ackWarnings'].includes(k)))fail('Controleer de wijziging.');
 const d=mergeDossier(source,local),todo=d.todos.find(t=>t.id===key(input.todo,'Deze todo is niet meer geldig. Heropen het dossier.')&&!t.review&&!t.archived);if(!todo)fail('Taak niet gevonden.');
 if(!['hotel','interrail','rename','option'].includes(input.kind)||!['auto','manual','keep'].includes(input.mode))fail('Kies het soort wijziging en tarief.');
 const line=d.lines.find(l=>l.id===key(input.line,'Kies de financiële regel die bij deze todo hoort.')&&!l.sourceRemoved);if(!line)fail('Kies bewust de financiële regel.');
 if(Object.entries(local.components||{}).some(([id,c])=>id!==todo.id&&c.line===line.id))fail('Deze financiële regel is al aan een andere taak gekoppeld.');
 const title=clean(input.title);if(!title)fail('Vul een naam in.');const oldComponent=local.components?.[todo.id];
 if(oldComponent?.line&&oldComponent.line!==line.id)fail('Deze taak is al gekoppeld aan een financiële regel. Gebruik die bestaande koppeling.');
 let c=input.kind==='rename'&&oldComponent?{...oldComponent,line:line.id}:{kind:input.kind,line:line.id},after={...todo,title},quoted={amount:total(line)},delta=0;
 if(input.kind==='hotel'){
  c={...c,hotel:key(input.hotel,'Kies een hotel uit de opgeslagen hotels.'),room:key(input.room,'Kies een kamer bij het geselecteerde hotel.'),board:clean(input.board||''),provider:clean(input.provider||''),checkin:day(input.checkin),checkout:day(input.checkout),rooms:count(input.rooms)};
  const hotel=catalogs.hotels.find(h=>h.id===c.hotel);if(!hotel?.rooms.some(r=>r.key===c.room))fail('Hotel of kamer niet gevonden.');count((Date.parse(c.checkout)-Date.parse(c.checkin))/86400000,366);after={...after,title:title===todo.title?hotel.title+' | '+hotel.rooms.find(r=>r.key===c.room).title:title,startDate:c.checkin,endDate:c.checkout,quantity:c.rooms,tag:'hotel'};
  if(input.mode==='keep'&&(!oldComponent||['hotel','room','board','provider','checkin','checkout','rooms'].some(k=>c[k]!==oldComponent[k])))fail('Bij gewijzigde hotelgegevens moet je herberekenen of een handmatig bedrag invullen.');
  quoted=input.mode==='keep'?quoted:hotelAmount(c,catalogs.hotels);if(todo.endDate)delta=(Date.parse(c.checkout)-Date.parse(day(todo.endDate.slice(0,10))))/86400000;
 }else if(input.kind==='interrail'){
  c={...c,pass:key(input.pass,'Kies een Interrail-pas bij Aantal dagen / geldigheid.'),class:clean(input.class),ageGroup:clean(input.ageGroup),count:count(input.count)};if(!['1','2'].includes(c.class)||!['adult','senior','youth','child'].includes(c.ageGroup))fail('Kies klasse en doelgroep.');if(input.mode==='keep')fail('Gebruik Herberekenen voor Interrail.');quoted=interrailAmount(c,catalogs.interrail);c.passTitle=catalogs.interrail.find(p=>p.id===c.pass)?.title||'';after={...after,quantity:c.count,title:title===todo.title?[c.passTitle,c.class+'e klas',({adult:'Volwassene',senior:'Senior',youth:'Jongere',child:'Kind'})[c.ageGroup]].filter(Boolean).join(' | '):title};
 }else{if(input.mode==='auto')fail('Kies tarief behouden of handmatig wijzigen.');if(input.kind==='option'){if(input.startDate)after.startDate=day(input.startDate);if(input.endDate)after.endDate=day(input.endDate);if(after.startDate&&after.endDate&&after.endDate<after.startDate)fail('Controleer de optiedatums.');}}
 if(input.mode==='manual'){if(!finite(input.amount)||input.amount<0||(c.kind==='hotel'||todo.tag==='hotel')&&cents(input.amount)<=0)fail('Vul een geldig handmatig totaalbedrag in.');quoted={amount:money(input.amount),manual:true,unavailable:quoted.unavailable===true,date:quoted.date||null};}
 const changes=[],warnings=[],missing=[];
 const add=(before,next,component,financial,result)=>{
  const changed=['title','startDate','endDate','quantity'].some(k=>next[k]!==before[k])||financial&&result.amount!==undefined&&result.amount!==total(financial);
  if(before.status==='done'&&changed){next={...next,status:'pending'};warnings.push('Een afgeronde taak wordt opnieuw te doen; de oude versie blijft met ❗ ter controle staan.');}
  if(result.manual&&component?.kind==='hotel')warnings.push(result.unavailable?'Dit hotel is volgens de opgeslagen tarieven niet beschikbaar voor '+result.date+'. Je gebruikt een handmatig tarief; controleer de beschikbaarheid zelf.':'Handmatig hoteltarief: controleer zelf de beschikbaarheid en het totaalbedrag.');
  if(result.missing)missing.push({todo:before.id,reason:result.missing});if(result.amount===null&&!result.missing)missing.push({todo:before.id,reason:'De bestaande financiële prijs is onvolledig.'});
  const amount=result.amount??null;if(amount!==null&&(!finite(amount)||amount<0))fail('Controleer het nieuwe totaal.');
  changes.push({todo:before.id,before,after:next,component,rate:result,financial:financial?{line:financial.id,before:financial,after:{...financial,title:next.title,...(amount!==null&&input.mode!=='keep'?{quantity:1,price:amount,costs:null}:{})},oldTotal:total(financial),newTotal:amount}:null});
 };
 add(todo,after,c,line,quoted);
 const shifted=input.shiftIds??[];if(!Array.isArray(shifted)||shifted.length>100||new Set(shifted).size!==shifted.length)fail('Controleer de vervolgonderdelen.');
 const manual=input.manualAmounts??{};if(!manual||typeof manual!=='object'||Array.isArray(manual)||Object.keys(manual).some(id=>!shifted.includes(id)))fail('Controleer de handmatige bedragen.');
 if(shifted.length&&(!delta||input.kind!=='hotel'||!todo.endDate))fail('Er is geen verschuiving om toe te passen.');
 for(const id of shifted){const r=d.todos.find(t=>t.id===key(id,'Een geselecteerd vervolgonderdeel is niet meer geldig. Heropen het dossier.')&&t.id!==todo.id&&!t.review&&!t.archived);if(!r||!r.startDate||r.startDate.slice(0,10)<todo.endDate.slice(0,10))fail('Kies uitsluitend vervolgonderdelen na de oorspronkelijke check-out.');
  const next={...r};for(const k of ['startDate','endDate','deadline','bookableFrom'])if(r[k])next[k]=shiftDay(r[k].slice(0,10),delta);
  const bound=local.components?.[id];if(r.tag==='hotel'||bound?.kind==='hotel'){
   if(!bound||bound.kind!=='hotel'){missing.push({todo:id,reason:'Koppel dit vervolghotel eerst aan een kamer en financiële regel.'});add(r,next,null,null,{});continue;}
   const component={...bound,checkin:next.startDate,checkout:next.endDate},linked=d.lines.find(l=>l.id===bound.line&&!l.sourceRemoved);if(!linked)fail('Financiële koppeling van een vervolghotel ontbreekt.');let result=hotelAmount(component,catalogs.hotels);if(Object.hasOwn(manual,id)){if(!finite(manual[id])||cents(manual[id])<=0)fail('Controleer het handmatige vervolgtarief.');result={amount:money(manual[id]),manual:true,unavailable:result.unavailable===true,date:result.date||null};}add(r,next,component,linked,result);
  }else{add(r,next,bound||null,null,{});}
 }
 if(input.kind==='interrail'&&(!oldComponent||oldComponent.class!==c.class)&&d.todos.some(t=>!t.review&&!t.archived&&t.status==='done'&&t.tag==='option'))warnings.push('Controleer de al afgevinkte opties/reserveringen: de Interrail-klasse is gewijzigd of was nog niet gekoppeld. Optiebedragen blijven gelijk.');
 if(input.mode!=='keep'&&changes.some(v=>v.financial&&v.financial.before.costs!==null))warnings.push('Bestaande werkelijke kosten moeten opnieuw worden gecontroleerd bij een herberekening; de oude bedragen blijven in de wijzigingshistorie.');
 const lineIds=changes.filter(x=>x.financial).map(x=>x.financial.line);if(new Set(lineIds).size!==lineIds.length)fail('Meerdere taken verwijzen naar dezelfde financiële regel. Controleer de koppelingen.');
 const replacements=new Map(changes.filter(x=>x.financial).map(x=>[x.financial.line,x.financial.newTotal]));const sum=fn=>{let n=0;for(const l of d.lines.filter(l=>!l.sourceRemoved)){const value=fn(l);if(value===null)return null;n+=cents(value);}return n/100;};
 return {changes,missing,warnings:[...new Set(warnings)],oldTotal:sum(total),newTotal:sum(l=>replacements.has(l.id)?replacements.get(l.id):total(l)),optionsUnchanged:true};
}
export function applyQuote(state,booking,source,plan,actor,at=new Date().toISOString()){
 if(plan.missing.length)fail('Vul eerst alle ontbrekende tarieven en koppelingen in.');const local=structuredClone(state.dossiers?.[booking]||{});local.todos??={};local.lines??={};local.components??={};local.reviews??=[];local.changes??=[];
 const overrides=(before,after)=>({...after,_edited:[...new Set([...(local.todos[before.id]?._edited||Object.keys(local.todos[before.id]||{}).filter(k=>!k.startsWith('_'))),...Object.keys(after).filter(k=>JSON.stringify(after[k])!==JSON.stringify(before[k]))])]});
 for(const change of plan.changes){const {before,after,financial,component}=change;local.todos[before.id]=overrides(before,after);local.todos[before.id]._edited=[...new Set([...local.todos[before.id]._edited,'status'])];if(component)local.components[before.id]=component;if(financial)local.lines[financial.line]={...financial.after,_edited:[...new Set([...(local.lines[financial.line]?._edited||Object.keys(local.lines[financial.line]||{}).filter(k=>!k.startsWith('_'))),'title','quantity','price','costs'])]};
  if(before.status==='done'&&after.status==='pending')local.reviews.push({...before,idOfOriginal:before.id,id:'review-'+randomUUID(),status:'caution',review:true,archived:false,changedAt:at,financial:financial?.before||null});
 }
 local.changes.push({id:randomUUID(),at,actor,changes:plan.changes.map(c=>({todo:c.todo,before:c.before,after:c.after,financial:c.financial,rate:c.rate})),oldTotal:plan.oldTotal,newTotal:plan.newTotal});state.dossiers??={};state.dossiers[booking]=local;
 state.history.push({at,actor,action:'reprice',booking});state.history=state.history.slice(-500);return state;
}
export function pricingFingerprint(v){const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');}
