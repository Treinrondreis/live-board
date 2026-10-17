import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFloraRegister} from './flora-register.mjs';
const env={REISSCHEMA_REGISTER_URL:'http://register.railway.internal:8080',REGISTER_FLORA_TOKEN:'fictional-flora-'+ 'x'.repeat(40)};
const response=legs=>new Response(JSON.stringify({offset:0,legs}));

test('unconfigured register is explicit and never makes requests',async()=>{
 const service=createFloraRegister({env:{},fetcher:()=>{throw Error('unexpected request');}});
 assert.deepEqual(await service.summary(),{configured:false,available:false,legs:[]});
});
test('cache is short lived and errors never show the previous itinerary',async()=>{
 let now=0,calls=0,fail=false;
 const service=createFloraRegister({env,clock:()=>now,fetcher:async()=>{calls++;if(fail)throw Error('fictional private value');return response([{dossier:'DEMO-A'}]);}});
 assert.equal((await service.summary()).legs.length,1);await service.summary();assert.equal(calls,1);
 now=30001;fail=true;const result=await service.summary();assert.equal(result.available,false);assert.deepEqual(result.legs,[]);assert.doesNotMatch(JSON.stringify(result),/fictional private value/);
});
test('one missing setting fails closed instead of pretending the connection is absent',async()=>{
 const service=createFloraRegister({env:{REISSCHEMA_REGISTER_URL:env.REISSCHEMA_REGISTER_URL}});
 const result=await service.summary();assert.equal(result.configured,true);assert.equal(result.available,false);
});
test('append check fixes destination, uses a header token and rejects forged actor',async()=>{
 let request;
 const service=createFloraRegister({env,fetcher:async(url,options)=>{request={url,options};return new Response('{"check_id":"fictional"}');}});
 const input={versionId:'00000000-0000-0000-0000-000000000001',outcome:'unchanged',sources:['Fictional timetable source'],requestId:'fictional-retry'};
 await assert.rejects(service.recordCheck({...input,actor:'forged'}));
 assert.deepEqual(await service.recordCheck(input),{ok:true});
 assert.match(request.url.pathname,/\/checks$/);assert.equal(request.options.headers.Authorization,'Bearer '+env.REGISTER_FLORA_TOKEN);
 assert.equal(JSON.parse(request.options.body).actor,undefined);
});

// Exercise the real handler boundaries with isolated non-network dependencies.
const handlerSource=await readFile(new URL('./flora.mjs',import.meta.url),'utf8');
const names=[...handlerSource.matchAll(/^import \{([^}]+)\} from .*;$/gm)].flatMap(m=>m[1].split(',').map(n=>n.trim()));
const isolated=names.map(n=>'const '+n+'=()=>{throw Error("Unexpected dependency");};').join('\n')+'\n'+handlerSource.replace(/^import .*;\n/gm,'');
const {createFloraHandler}=await import('data:text/javascript;base64,'+Buffer.from(isolated).toString('base64'));
async function call({signedIn=true,method='GET',origin='https://treinbord.up.railway.app',path='/api/register',input={}}={}){
 let accessed=0,status,body;
 const register={summary:async()=>{accessed++;return {configured:true,available:true,legs:[{dossier:'DEMO-A'}]};},recordCheck:async()=>{accessed++;return {ok:true};}};
 const handler=createFloraHandler({authenticate:async()=>signedIn,register});
 const req={method,headers:{origin,'x-flora':'1','content-type':'application/json'},async *[Symbol.asyncIterator](){yield JSON.stringify(input);}};
 const res={setHeader(){},writeHead(code){status=code;},end(value){body=JSON.parse(value);}};
 await handler(req,res,new URL('/seinhuis/flora'+path,'https://example.invalid'));
 return {status,body,accessed};
}
test('Flora authentication precedes register access',async()=>{
 const result=await call({signedIn:false});assert.equal(result.status,401);assert.equal(result.accessed,0);
 assert.equal((await call()).status,200);
});
test('append check requires the existing origin and CSRF boundary',async()=>{
 const rejected=await call({method:'POST',path:'/api/register/check',origin:'https://example.invalid'});
 assert.equal(rejected.status,403);assert.equal(rejected.accessed,0);
 assert.equal((await call({method:'POST',path:'/api/register/check'})).status,200);
});

