import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReisschemasHandler} from './reisschemas.mjs';

async function call({signedIn=true,path='/seinhuis/reisschemas/api/register',method='GET'}={}){
 let accessed=0,status,body,headers={};
 const handler=createReisschemasHandler({authenticate:async()=>signedIn,register:{summary:async()=>{accessed++;return {configured:true,available:true,legs:[]};}}});
 const handled=await handler({method,headers:{}},{setHeader(k,v){headers[k]=v;},writeHead(code,h){status=code;Object.assign(headers,h);},end(value){body=String(value);}},new URL(path,'https://example.invalid'));
 return {handled,accessed,status,body,headers};
}
test('separate section authenticates before reading data or assets',async()=>{
 const denied=await call({signedIn:false});assert.equal(denied.status,401);assert.equal(denied.accessed,0);
 const asset=await call({signedIn:false,path:'/seinhuis/reisschemas/reisschemas.js'});assert.equal(asset.status,401);
 const home=await call({signedIn:false,path:'/seinhuis/reisschemas/'});assert.equal(home.status,303);assert.equal(home.headers.Location,'/seinhuis');
 const allowed=await call();assert.equal(allowed.status,200);assert.equal(allowed.accessed,1);assert.equal(allowed.headers['Cache-Control'],'no-store');
});
test('section has no write route and does not capture sibling paths',async()=>{
 const denied=await call({method:'POST'});assert.equal(denied.status,405);assert.equal(denied.accessed,0);
 assert.equal((await call({path:'/seinhuis/reisschemas/api/check',method:'POST'})).status,405);
 assert.equal((await call({path:'/seinhuis/reisschemas-other'})).handled,false);
 assert.equal((await call({path:'/seinhuis/reisschemas/unknown'})).status,404);
});
test('page serves standalone assets and an explicit communication notice',async()=>{
 const page=await call({path:'/seinhuis/reisschemas/'});assert.equal(page.status,200);assert.match(page.body,/Reisschema’s/);assert.match(page.body,/geen klantberichten automatisch/);assert.doesNotMatch(page.body,/seinhuis\/flora/);
 const source=await readFile(new URL('./reisschemas.mjs',import.meta.url),'utf8');assert.match(source,/adminAuthenticated\(req\)/);assert.doesNotMatch(source,/adminAuthenticated\(req,'flora'\)/);
});
test('Flora no longer imports, reads or writes the itinerary register',async()=>{
 const flora=await readFile(new URL('./flora.mjs',import.meta.url),'utf8'),ui=await readFile(new URL('./flora-trains.js',import.meta.url),'utf8');
 assert.doesNotMatch(flora,/floraRegister|register\.summary|register\.recordCheck|api\/register/);assert.doesNotMatch(ui,/renderRegistry|reisschema-register/);
 const hub=await readFile(new URL('./admin-hub.mjs',import.meta.url),'utf8');assert.match(hub,/hubSections\.reisschemas=/);assert.match(hub,/reisschemas:'owner'/);
});

test('favicon is linked and allowed by the page image policy',async()=>{
 const page=await call({path:'/seinhuis/reisschemas/'});
 assert.match(page.headers['Content-Security-Policy'],/img-src 'self';/);
 assert.match(page.headers['Content-Security-Policy'],/default-src 'none';/);
 assert.match(page.body,/rel="icon"[^>]+reisschemas\.svg/);
 assert.match(page.body,/rel="icon"[^>]+reisschemas\.ico/);
});

test('primary controls stay compact and settings are collapsed',async()=>{
 const page=await call({path:'/seinhuis/reisschemas/'});
 assert.match(page.body,/<nav[^>]*>[\s\S]*id="mode-bookings"[\s\S]*id="run-controls"[\s\S]*<\/nav>/);
 assert.match(page.body,/<details class="control-settings"><summary>Controle-instellingen<\/summary>[\s\S]*id="toggle-controls"[\s\S]*id="connect-drafts"[\s\S]*<\/details>/);
 assert.doesNotMatch(page.body,/Dagelijks om 00:30|id="punctuality-status"|id="control-source-status"/);
});
