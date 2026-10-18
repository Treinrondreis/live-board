import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {createReisschemasHandler} from './reisschemas.mjs';
import {createControlRoutes} from './reisschema-runtime.mjs';
const leg={status:'active',dossier:'DEMO',booking_key:'Fictieve reis',version_id:'00000000-0000-4000-8000-000000000001',leg_id:'00000000-0000-4000-8000-000000000002',sequence:1,role:'primary',train_number:'TEST 700',travel_date:'2031-06-10',arrival_date:'2031-06-10',departure_time:'10:00',arrival_time:'12:00',from_station:'Voorbeeld Noord',to_station:'Voorbeeld Zuid',document_url:'https://docs.google.com/document/d/fictional/edit',observation_revision:'fictional-revision',observation:{change_key:'fictional',departure_date:'2031-06-10',departure_time:'09:55',arrival_date:'2031-06-10',arrival_time:'12:10',source:'Fictieve bron',observed_at:'2031-06-02T12:00:00Z'},control:{outcome:'checked',checked_at:'2031-06-02T12:00:00Z',assessment:{backupReview:true}}};
const handler=createReisschemasHandler({authenticate:async()=>true,register:{summary:async()=>({configured:true,available:true,legs:[leg,{...leg,leg_id:'manual',dossier:'DEMO-OTHER',observation:null,control:{outcome:'manual',checked_at:'2031-06-02T12:00:00Z',reason:'Geen volledige dekking <onveilig>'}}]})},lookupPlans:async()=>[],controls:createControlRoutes({cycle:{status:async()=>({enabled:false})},mail:{status:async()=>({connected:false})},google:{}})});
const server=http.createServer((req,res)=>{void handler(req,res,new URL(req.url,'http://localhost')).then(done=>{if(!done){res.writeHead(404);res.end();}});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/seinhuis/reisschemas');
 await page.getByText('Dagelijkse controles uitgeschakeld.',{exact:false}).waitFor();
 assert.equal(await page.locator('.manual-task').filter({hasText:'Geen volledige dekking <onveilig>'}).count(),1);
 await page.locator('[data-edit-leg="'+leg.leg_id+'"]').click();await page.locator('#draft-form').waitFor({state:'visible'});
 assert.equal(await page.locator('#new-from-station').inputValue(),'Voorbeeld Noord');
 assert.equal(await page.locator('#draft-destination').inputValue(),'');
 await page.locator('#draft-to').fill('example@example.invalid');await page.locator('#draft-destination').fill('Voorbeeld Zuid');await page.locator('#draft-advice').fill('Gecontroleerd fictief advies.');
 assert.equal(await page.locator('#create-draft').isEnabled(),true);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#draft-form').isVisible(),true);assert.deepEqual(errors,[]);
 console.log('Reisschema controls: desktop, mobile, manual task escaping and separate draft form passed.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
