import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReishuisHandler} from './reishuis.mjs';
import {emptyReishuis} from './reishuis-store.mjs';
let state=emptyReishuis(),revision=0,origin;
const list=Array.from({length:36},(_,i)=>({id:'fixture-'+i,index:String(900+i),name:'Fictieve Reiziger '+i,status:i<12?'te verwerken':i<20?'interrail leveren':i<28?'wacht op reactie klant':'afgehandeld',departure:'2020-01-01',return:'2099-12-31',created:'2026-10-'+String(i%28+1).padStart(2,'0'),photo:null}));
state.customers=[{id:'fixture-customer',name:'Fictieve Klant'}];
let handler;const server=http.createServer((req,res)=>void handler(req,res,new URL(req.url,origin)));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
handler=createReishuisHandler({origin,authenticate:async req=>req.headers.cookie?.includes('fixture=allowed'),actor:async()=> 'fixture-user',read:async()=>({state:structuredClone(state),revision}),write:async(s,r)=>{assert.equal(r,revision);state=s;return ++revision;},fetchBookings:async()=>list});
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const denied=await page.goto(origin+'/seinhuis/reishuis/');assert.equal(denied.status(),403);
 await page.context().addCookies([{name:'fixture',value:'allowed',url:origin}]);await page.reload();await page.locator('.card').first().waitFor();assert.equal(await page.locator('.booking-row').count(),5);assert.equal(await page.locator('.booking-row').first().locator('.card').count(),5);
 await page.screenshot({path:process.env.REISHUIS_SCREENSHOT||join(tmpdir(),'reishuis-test.png'),fullPage:true});
 await page.getByRole('button',{name:'Volgende vijf boekingen'}).first().click();await page.waitForFunction(()=>document.querySelector('.pager span').textContent==='2 / 3');
 await page.getByRole('searchbox',{name:'Zoek boekingsnummer of klantnaam'}).fill('900');await page.waitForFunction(()=>document.querySelectorAll('.card').length===2);
 await page.locator('.card').first().click();await page.getByRole('combobox',{name:'Klant kiezen'}).selectOption('fixture-customer');await page.getByRole('button',{name:'Boeking koppelen',exact:true}).click();await page.getByText('Gekoppeld aan Fictieve Klant').waitFor();assert.equal(state.links['fixture-0'],'fixture-customer');
 await page.getByRole('textbox',{name:'Eigen notitie'}).fill('<img src=x onerror=alert(1)>');await page.getByRole('button',{name:'Notitie opslaan'}).click();await page.getByText('Notitie opgeslagen.').waitFor();assert.equal(state.notes['booking:fixture-0'],'<img src=x onerror=alert(1)>');assert.equal(await page.locator('#detail img').count(),0);
 await page.getByRole('button',{name:'Sluiten',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'Rijen instellen'}).click();await page.getByRole('combobox',{name:'Status rij 1',exact:true}).selectOption('interrail leveren');await page.getByRole('button',{name:'Instellingen opslaan'}).click();await page.locator('#preferences').waitFor({state:'hidden'});assert.equal(state.preferences['fixture-user'][0].status,'interrail leveren');
 await page.getByRole('searchbox',{name:'Zoek boekingsnummer of klantnaam'}).fill('');await page.getByRole('button',{name:'Vernieuwen'}).click();await page.getByRole('button',{name:'Klanten',exact:true}).click();await page.getByRole('textbox',{name:'Nieuwe klant',exact:true}).fill('Fictieve Andere Klant');await page.getByRole('button',{name:'Klant toevoegen'}).click();await page.waitForFunction(()=>document.querySelectorAll('.profile').length===2);assert.equal(state.customers.length,2);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:process.env.REISHUIS_MOBILE_SCREENSHOT||join(tmpdir(),'reishuis-mobile-test.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS Reishuis browser: denied access, five rows, paging, search, explicit link, escaped note, saved settings, customer creation, mobile layout');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
