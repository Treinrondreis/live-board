import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('./reisschemas.js',import.meta.url),'utf8');
const leg=(extra={})=>({dossier:'DEMO-A',booking_key:'Fictieve reis',sequence:1,travel_date:'2031-06-10',arrival_date:'2031-06-10',train_number:'TEST 210',from_station:'Voorbeeld Noord',to_station:'Voorbeeld Zuid',departure_time:'10:00',arrival_time:'12:00',role:'primary',document_url:'https://docs.google.com/document/d/fictional/edit',...extra});
async function setup(rows){
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return nodes.get(id);};
 let fail=false;
 runInNewContext(source,{document:{getElementById:get},URL,fetch:async url=>{assert.equal(url,'/seinhuis/reisschemas/api/register');if(fail)throw Error('private detail');return {ok:true,json:async()=>({configured:true,available:true,legs:rows})};}});
 await get('refresh').onclick();
 return {get,input(id,value){get(id).value=value;get(id).oninput();},fail(){fail=true;},choice(i){get('booking-results').onclick({target:{closest:()=>({dataset:{choice:String(i)}})}});}};
}
test('train number and departure date intersect; numeric search is exact',async()=>{
 const {get,input}=await setup([leg(),leg({travel_date:'2031-06-11',arrival_date:'2031-06-11'}),leg({train_number:'TEST 1210'}),leg({train_number:'TEST 210A'})]);
 input('train-number','210');input('train-date','2031-06-10');assert.match(get('summary').textContent,/1 rit · 1 boeking/);assert.doesNotMatch(get('register').innerHTML,/1210|210A|11-06-2031/);
 input('train-number','TEST 210');assert.match(get('summary').textContent,/1 rit/);
 input('train-date','2031-06-12');assert.match(get('register').innerHTML,/Geen ritten gevonden/);
 get('clear-trains').onclick();assert.match(get('summary').textContent,/4 ritten/);
});
test('booking opens with document and all days; local filters do not cross bookings',async()=>{
 const {get,input}=await setup([leg({sequence:2,train_number:'TEST 211'}),leg({sequence:1}),leg({sequence:3,travel_date:'2031-06-11',arrival_date:'2031-06-12',to_station:'Voorbeeld Oost',train_number:'NIGHT 900'}),leg({dossier:'OTHER-A',train_number:'TEST 777'})]);
 input('booking-number','demo');assert.equal(get('booking-detail').hidden,false);assert.match(get('booking-header').innerHTML,/Reisschema openen/);assert.match(get('booking-header').innerHTML,/document-button/);assert.match(get('day-summary').textContent,/3 ritten op 2 reisdagen/);assert.doesNotMatch(get('booking-days').innerHTML,/TEST 777/);
 const html=get('booking-days').innerHTML;assert.ok(html.indexOf('TEST 210')<html.indexOf('TEST 211'));assert.match(html,/Aankomst 12-06-2031/);
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
 get('register').onclick({target:{closest:()=>({dataset:{booking:JSON.stringify(['DEMO-A','Tweede'])}})}});
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
