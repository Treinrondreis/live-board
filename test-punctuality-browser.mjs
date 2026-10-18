import assert from 'node:assert/strict';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {initPunctuality,configurePunctuality,recordPunctuality} from './punctuality.mjs';
import {createReisschemasHandler} from './reisschemas.mjs';
const sqlite=new DatabaseSync(':memory:'),at=Date.parse('2031-06-10T08:30:00Z'),planned=at-30*60000;
const leg={status:'active',dossier:'DEMO',booking_key:'Fictieve reis',leg_id:'00000000-0000-4000-8000-000000000001',version_id:'00000000-0000-4000-8000-000000000002',sequence:1,train_number:'TEST 700',from_station:'Example North',to_station:'Example South',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00'};
await initPunctuality({sqlite});configurePunctuality({getLegs:async()=>({available:true,legs:[leg]})});
await recordPunctuality([{number:'700',observedAt:leg.from_station,eventMode:'departure',plannedTimestamp:planned,expectedTimestamp:planned+12*60000,hasRealtime:true}],'Fictional <source>',at);
const handler=createReisschemasHandler({authenticate:async()=>true,register:{summary:async()=>({configured:true,available:true,legs:[leg]})},lookupPlans:async()=>[],controls:async()=>false});
const server=http.createServer((req,res)=>void handler(req,res,new URL(req.url,'http://localhost')).then(done=>{if(!done){res.writeHead(404);res.end();}}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/seinhuis/reisschemas');await page.locator('#register .delay-minutes').waitFor();
 assert.equal(await page.locator('#register .delay-minutes').innerText(),'+12');assert.equal(await page.locator('#register .delay-minutes').evaluate(e=>getComputedStyle(e).color),'rgb(197, 32, 38)');
 assert.equal(await page.locator('#register .time-cell strong').first().innerText(),'10:00');assert.equal(await page.locator('#register del').count(),0);
 assert.equal(await page.getByText('Actueel 10:12',{exact:true}).count(),1);
 await mkdir(new URL('./outputs/',import.meta.url),{recursive:true});await page.locator('#register').screenshot({path:new URL('./outputs/reisschema-stiptheid-voorbeeld.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')});
 await page.getByRole('button',{name:'Stiptheidshistorie',exact:true}).click();await page.locator('#punctuality-history tbody tr').waitFor();
 assert.match(await page.locator('#punctuality-history').innerText(),/Fictional <source>/);assert.equal(await page.locator('#punctuality-history script').count(),0);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#register .delay-minutes').innerText(),'+12');assert.deepEqual(errors,[]);
 console.log('Punctuality: preserved planned time, red +minutes, expected/actual distinction, retained escaped history and mobile passed.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));sqlite.close();}
