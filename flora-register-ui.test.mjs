import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {numberAssessment,controlPolicy,manualControlAttention} from './reisschema-number-policy.mjs';
import {punctualityView} from './punctuality-view.mjs';
// The real browser loads the policy as an ES module; inject those same exports into this DOM unit harness.
const source=(await readFile(new URL('./reisschemas.js',import.meta.url),'utf8')).replace(/^import \{numberAssessment,controlPolicy,manualControlAttention\} from '\.\/reisschema-number-policy\.mjs';\r?\n/,'').replace(/^import \{punctualityView\} from '\.\/punctuality-view\.mjs';\r?\n/,'');
const leg=(extra={})=>({dossier:'DEMO-A',booking_key:'Fictieve reis',sequence:1,travel_date:'2031-06-10',arrival_date:'2031-06-10',train_number:'TEST 210',from_station:'Voorbeeld Noord',to_station:'Voorbeeld Zuid',departure_time:'10:00',arrival_time:'12:00',role:'primary',document_url:'https://docs.google.com/document/d/fictional/edit',...extra});
async function setup(rows,now='2031-06-10T22:30:00Z'){
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return nodes.get(id);};
 let fail=false;
 runInNewContext(source,{numberAssessment,controlPolicy,manualControlAttention,punctualityView,Date:FixedDate,document:{getElementById:get},URL,fetch:async url=>{assert.equal(url,'/seinhuis/reisschemas/api/register');if(fail)throw Error('private detail');return {ok:true,json:async()=>({configured:true,available:true,legs:rows})};}});
 await get('refresh').onclick();
 return {get,input(id,value){get(id).value=value;get(id).oninput();},fail(){fail=true;},choice(i){get('booking-results').onclick({target:{closest:()=>({dataset:{choice:String(i)}})}});}};
}
test('train number and departure date intersect; numeric search is exact',async()=>{
 const {get,input}=await setup([leg(),leg({travel_date:'2031-06-11',arrival_date:'2031-06-11'}),leg({train_number:'TEST 1210'}),leg({train_number:'TEST 210A'})]);
 input('train-number','210');input('train-date','2031-06-10');input('train-until','2031-06-10');assert.match(get('summary').textContent,/1 rit · 1 boeking/);assert.doesNotMatch(get('register').innerHTML,/1210|210A|11-06-2031/);
 input('train-number','TEST 210');assert.match(get('summary').textContent,/1 rit/);
 input('train-date','2031-06-12');input('train-until','2031-06-12');assert.match(get('register').innerHTML,/Geen ritten gevonden/);
 get('clear-trains').onclick();assert.match(get('summary').textContent,/4 ritten/);
});
test('booking opens with document and all days; local filters do not cross bookings',async()=>{
 const {get,input}=await setup([leg({sequence:2,train_number:'TEST 211'}),leg({sequence:1}),leg({sequence:3,travel_date:'2031-06-11',arrival_date:'2031-06-12',to_station:'Voorbeeld Oost',train_number:'NIGHT 900'}),leg({dossier:'OTHER-A',train_number:'TEST 777'})]);
 input('booking-number','demo');assert.equal(get('booking-detail').hidden,false);assert.match(get('booking-header').innerHTML,/Reisschema openen/);assert.match(get('booking-header').innerHTML,/document-button/);assert.match(get('day-summary').textContent,/3 ritten op 2 reisdagen/);assert.doesNotMatch(get('booking-days').innerHTML,/TEST 777/);
 const html=get('booking-days').innerHTML;assert.ok(html.indexOf('TEST 210')<html.indexOf('TEST 211'));assert.match(html,/12-06-2031/);
 input('booking-date','2031-06-11');input('booking-route','Noord → Oost');input('booking-train','900');assert.match(get('day-summary').textContent,/1 rit op 1 reisdag/);
 input('booking-train','777');assert.match(get('booking-days').innerHTML,/Geen ritten gevonden binnen deze boeking/);
 get('clear-booking').onclick();assert.match(get('day-summary').textContent,/3 ritten op 2 reisdagen/);
});
test('duplicate dossiers stay separate and require a choice',async()=>{
 const {get,input,choice}=await setup([leg({booking_key:'Variant Noord'}),leg({booking_key:'Variant Zuid',train_number:'TEST 999'})]);
 input('booking-number','DEMO-A');assert.equal(get('booking-detail').hidden,true);assert.match(get('booking-summary').textContent,/2 boekingen gevonden/);assert.match(get('booking-results').innerHTML,/Variant Noord/);assert.match(get('booking-results').innerHTML,/Variant Zuid/);
 choice(1);assert.equal(get('booking-detail').hidden,false);assert.match(get('booking-days').innerHTML,/TEST 999/);assert.doesNotMatch(get('booking-days').innerHTML,/TEST 210/);
});
test('train result opens the exact duplicate booking and switches views',async()=>{
 const rows=[leg(),leg({booking_key:'Tweede',train_number:'TEST 999'})],{get}=await setup(rows);
 get('register').onclick({target:{closest:selector=>selector==='[data-booking]'?({dataset:{booking:JSON.stringify(['DEMO-A','Tweede'])}}):null}});
 assert.equal(get('trains-panel').hidden,true);assert.equal(get('bookings-panel').hidden,false);assert.equal(get('mode-bookings').attributes['aria-pressed'],'true');assert.match(get('booking-header').innerHTML,/Tweede/);assert.match(get('booking-days').innerHTML,/TEST 999/);assert.doesNotMatch(get('booking-days').innerHTML,/TEST 210/);
});
test('source fields are escaped and document links are restricted in both views',async()=>{
 const {get,input}=await setup([leg({from_station:'<img onerror="alert(1)">',booking_key:'<script>unsafe</script>',document_url:'javascript:alert(1)'})]);
 assert.match(get('register').innerHTML,/&lt;img/);assert.doesNotMatch(get('register').innerHTML,/<script>|<img|href="javascript:/);
 input('booking-number','demo');assert.match(get('booking-header').innerHTML,/&lt;script&gt;/);assert.doesNotMatch(get('booking-header').innerHTML,/href=|<script>/);assert.match(get('booking-days').innerHTML,/&lt;img/);
});
test('failed refresh clears both views and never exposes internal errors',async()=>{
 const {get,input,fail}=await setup([leg()]);input('booking-number','demo');assert.match(get('booking-days').innerHTML,/TEST 210/);
 fail();await get('refresh').onclick();assert.equal(get('register').innerHTML,'');assert.equal(get('booking-days').innerHTML,'');assert.equal(get('booking-header').innerHTML,'');assert.equal(get('booking-detail').hidden,true);assert.doesNotMatch(get('status').textContent,/private detail/);
});


test('journey columns follow departure route arrival and only backups carry a label',async()=>{
 const {get,input}=await setup([leg(),leg({sequence:2,role:'backup',train_number:'TEST 211',arrival_date:'2031-06-11'})]);
 input('booking-number','demo');const html=get('booking-days').innerHTML;
 assert.ok(html.indexOf('>Vertrek</th>')<html.indexOf('>Traject</th>'));
 assert.ok(html.indexOf('>Traject</th>')<html.indexOf('>Aankomst</th>'));
 assert.match(html,/<td class="time-cell"><strong>10:00<\/strong>/);
 assert.match(html,/arrival-date/);assert.match(html,/Back-up/);assert.doesNotMatch(html,/Hoofdrit|Vertrek \/ aankomst/);
 assert.ok(html.indexOf('10:00')<html.indexOf('Voorbeeld Noord'));assert.ok(html.indexOf('Voorbeeld Zuid')<html.indexOf('12:00'));
});


test('periods include both bounds and overnight journeys; quick dates use Amsterdam',async()=>{
 const {get,input}=await setup([leg({travel_date:'2031-06-10',arrival_date:'2031-06-11'}),leg({travel_date:'2031-06-11',arrival_date:'2031-06-11'}),leg({travel_date:'2031-06-12',arrival_date:'2031-06-12'}),leg({travel_date:'2031-06-13',arrival_date:'2031-06-13'})]);
 input('train-date','2031-06-11');input('train-until','2031-06-12');assert.match(get('summary').textContent,/3 ritten/);
 get('train-today').onclick();assert.equal(get('train-date').value,'2031-06-11');assert.equal(get('train-until').value,'2031-06-11');assert.match(get('summary').textContent,/2 ritten/);
 get('train-tomorrow').onclick();assert.equal(get('train-date').value,'2031-06-12');assert.match(get('summary').textContent,/1 rit/);
 get('train-after').onclick();assert.equal(get('train-date').value,'2031-06-13');
 input('train-date','2031-06-14');assert.match(get('summary').textContent,/0 ritten/);
});

test('multiple exact train numbers combine with ordered partial station names in both views',async()=>{
 const {get,input}=await setup([leg({train_number:'TEST 700',from_station:'Example North Central',to_station:'Example South Hbf'}),leg({sequence:2,train_number:'NIGHT 701',from_station:'Example South Hbf',to_station:'Example North Central'}),leg({sequence:3,train_number:'TEST 1700',from_station:'Example North Central',to_station:'Example South Hbf'})]);
 input('train-number','700, NIGHT 701');assert.match(get('summary').textContent,/2 ritten/);
 input('search','North South');assert.match(get('summary').textContent,/1 rit/);assert.match(get('register').innerHTML,/TEST 700/);assert.doesNotMatch(get('register').innerHTML,/NIGHT 701|TEST 1700/);
 input('booking-number','demo');input('booking-train','700; 701');input('booking-route','South North');assert.match(get('day-summary').textContent,/1 rit/);assert.match(get('booking-days').innerHTML,/NIGHT 701/);
});

const observation=(extra={})=>({departure_date:'2031-06-10',departure_time:'09:56',arrival_date:'2031-06-10',arrival_time:'12:10',cancelled:false,connection_broken:false,backup_communicated:false,source:'Fictional planner',observed_at:'2031-06-09T12:00:00Z',change_key:'current',...extra});
test('four-minute advance alerts; old times are struck through; checkmarks match the exact change',async()=>{
 const {get}=await setup([leg({observation:observation(),communication:{change_key:'current',communicated_at:'2031-06-09T13:00:00Z'}})]);
 const html=get('register').innerHTML;assert.match(html,/<del[^>]*>10:00/);assert.match(html,/<del[^>]*>12:00/);assert.match(html,/09:56/);assert.match(html,/12:10/);assert.match(html,/Aandacht nodig/);assert.match(html,/Wijziging gecommuniceerd/);
 const later=await setup([leg({observation:observation({departure_time:'10:03'}),communication:{change_key:'older',communicated_at:'2031-06-09T13:00:00Z'}})]);
 assert.match(later.get('register').innerHTML,/<del[^>]*>10:00/);assert.doesNotMatch(later.get('register').innerHTML,/Aandacht nodig|Wijziging gecommuniceerd/);
 const slight=await setup([leg({observation:observation({departure_time:'09:57'})})]);assert.doesNotMatch(slight.get('register').innerHTML,/Aandacht nodig/);
});
test('missed connection alerts unless a suitable backup was communicated; cancellation still alerts',async()=>{
 const broken=await setup([leg({observation:observation({departure_time:'10:00',connection_broken:true})})]);assert.match(broken.get('register').innerHTML,/Aandacht nodig/);
 const backed=await setup([leg({observation:observation({departure_time:'10:00',connection_broken:true,backup_communicated:true})})]);assert.doesNotMatch(backed.get('register').innerHTML,/Aandacht nodig/);assert.match(backed.get('register').innerHTML,/back-up gecommuniceerd/);
 const cancelled=await setup([leg({observation:observation({departure_time:'10:00',cancelled:true,backup_communicated:true})})]);assert.match(cancelled.get('register').innerHTML,/Aandacht nodig/);
});
test('number notices retain both numbers, escape the reason and are searchable in both views',async()=>{
 const row=leg({train_number:'ICE 700',observation:observation({train_number:'ICE 701'}),control:{outcome:'checked',checked_at:'2031-06-09T12:00:00Z',reason:'Treinnummer gewijzigd. Nu ICE 701 <unsafe>'}});
 const {get,input}=await setup([row,leg({sequence:2,train_number:'IC 702'})]);
 get('filter-numbers').onclick();assert.match(get('summary').textContent,/1 rit/);assert.equal(get('filter-numbers').attributes['aria-pressed'],'true');assert.match(get('register').innerHTML,/Nu ICE 701/);assert.match(get('register').innerHTML,/&lt;unsafe&gt;/);
 input('train-number','701');assert.match(get('summary').textContent,/1 rit/);
 input('search','nummer gewijzigd');assert.match(get('summary').textContent,/1 rit/);
 input('booking-number','demo');input('booking-train','701');assert.match(get('day-summary').textContent,/1 rit/);
});
