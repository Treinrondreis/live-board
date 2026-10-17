import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {normalizeDossier,fetchReishuisDossier,mergeDossier,changeDossier,createDossierCache} from './reishuis-dossier.mjs';
import {createReishuisHandler} from './reishuis.mjs';
import {emptyReishuis,initReishuis,readReishuis,writeReishuis,readDossierSnapshot,writeDossierSnapshot} from './reishuis-store.mjs';
import {invoiceTotals} from './reishuis-dossier-ui.js';
const raw=()=>({_id:'private.fixture',firstName:'Fictief',lastName:'Voorbeeld',address:'Voorbeeldstraat 1',postalCode:'0000 AA',city:'Voorbeeldstad',notes:'Bronnotitie',comment:'Fictieve opmerking',initialPrice:200,passengers:[{firstName:'Fictief',passport:'NEVER-IMPORT'}],todos:[{_key:'task-1',title:'Fictieve taak',description:'Bron taak',done:true}],lines:[{_key:'line-1',title:'Fictieve regel',price:100,costs:75,quantity:2}]});
const source=()=>normalizeDossier(raw());
test('financial payment import excludes URLs and provider identifiers',()=>{const d=normalizeDossier({...raw(),payments:[{price:100,status:'open',checkoutUrl:'NEVER-IMPORT',pspId:'NEVER-IMPORT',fulfillments:[{amount:25,date:'2026-10-17',pspId:'NEVER-IMPORT'}]}]});assert.equal(d.payments[0].fulfillments[0].amount,25);assert.ok(!JSON.stringify(d).includes('NEVER-IMPORT'));});
test('invoice totals distinguish unknown actual costs, credit lines, cents and archived edits',()=>{
 assert.deepEqual(invoiceTotals([{quantity:3,price:0.1,costs:0},{quantity:1,price:-0.1,costs:null},{quantity:0,price:100,costs:100},{quantity:1,price:999,costs:999,sourceRemoved:true}]),{total:0.2,cost:0,missing:1,invalid:0,archived:1});
 assert.equal(invoiceTotals([{quantity:1,price:null,costs:5}]).invalid,1);
});
test('dossier reads only projected fields by parameterized GET and prefers draft',async()=>{
 const d=await fetchReishuisDossier('private.fixture',{config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{
  assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.searchParams.get('$id'),'"private.fixture"');assert.equal(u.searchParams.get('$draft'),'"drafts.private.fixture"');assert.equal(u.searchParams.get('perspective'),'raw');assert.doesNotMatch(u.searchParams.get('query'),/passport|documents|checkoutUrl|dashboardUrl|pspId|\.\.\./);
  return {ok:true,json:async()=>({result:[raw(),{...raw(),_id:'drafts.private.fixture',notes:'Conceptnotitie'}]})};
 }});assert.equal(d.notes,'Conceptnotitie');assert.equal(d.passengers[0].passport,undefined);assert.equal(d.todos[0].status,'done');
 await assert.rejects(fetchReishuisDossier('private.fixture',{config:{token:'fixture',project:'other',dataset:'production'}}));
});
test('local notes, personal, todo and financial edits survive source refresh and reordering',()=>{
 const s=emptyReishuis(),d=source(),old=structuredClone(d);
 changeDossier(s,{booking:'private.fixture',section:'notes',values:{notes:'Eigen notitie'}},d);
 changeDossier(s,{booking:'private.fixture',section:'personal',values:{address:'Testlaan 2'}},d);
 changeDossier(s,{booking:'private.fixture',section:'todo',item:d.todos[0].id,values:{status:'doing',description:'Eigen taaknotitie'}},d);
 changeDossier(s,{booking:'private.fixture',section:'line',item:d.lines[0].id,values:{price:123.45,costs:80,quantity:3}},d);
 const fresh=normalizeDossier({...raw(),notes:'Nieuwe bron',todos:[{_key:'new',title:'Nieuwe brontaak'},...raw().todos],lines:[{_key:'new-line',price:1},...raw().lines]});
 const merged=mergeDossier(fresh,s.dossiers['private.fixture']);assert.equal(merged.notes,'Eigen notitie');assert.equal(merged.comment,'Fictieve opmerking');assert.equal(merged.personal.address,'Testlaan 2');assert.equal(merged.todos.find(r=>r.id===d.todos[0].id).description,'Eigen taaknotitie');assert.equal(merged.lines.find(r=>r.id===d.lines[0].id).costs,80);assert.deepEqual(d,old,'source never mutated');
 const removed=mergeDossier({...fresh,todos:[]},s.dossiers['private.fixture']);assert.equal(removed.todos[0].sourceRemoved,true,'orphaned local edits remain visible');
 changeDossier(s,{booking:'private.fixture',section:'todo',add:true,values:{title:'Eigen nieuwe taak'}},d);assert.ok(mergeDossier(d,s.dossiers['private.fixture']).todos.some(t=>t.local));
});
test('fallback identities survive reordered legacy rows and missing actual costs remain unknown',()=>{
 const a=normalizeDossier({...raw(),lines:[{title:'A',price:10},{title:'B',price:20,quantity:0}]}),b=normalizeDossier({...raw(),lines:[{title:'B',price:20,quantity:0},{title:'A',price:10}]});
 assert.equal(a.lines[0].id,b.lines[1].id);assert.equal(a.lines[0].quantity,1);assert.equal(a.lines[0].costs,null);assert.equal(a.lines[1].quantity,0);
});
test('dossier edit validation rejects prototype keys, unknown fields, forged rows and invalid finances',()=>{
 const d=source(),base={booking:'private.fixture',section:'line',item:d.lines[0].id};
 for(const values of [{price:NaN},{price:Infinity},{quantity:-1},{costs:'5'},{vatRate:101},{price:1e20},{pspId:'forged'},{date:'2026-02-30'}])assert.throws(()=>changeDossier(emptyReishuis(),{...base,values},d),{status:400});
 for(const input of [{...base,item:'forged',values:{price:1}},{...base,booking:'__proto__',values:{price:1}},{...base,values:JSON.parse('{"__proto__":{"bad":true}}')}])assert.throws(()=>changeDossier(emptyReishuis(),input,d),{status:400});
 const s=emptyReishuis();changeDossier(s,{...base,values:{costs:null,price:-10,quantity:0}},d);assert.equal(s.dossiers['private.fixture'].lines[d.lines[0].id].price,-10);
});
test('dossier snapshots and local edits persist separately and reject stale writes',async()=>{
 const sqlite=new DatabaseSync(':memory:');initReishuis({sqlite});const s=emptyReishuis(),d=source();changeDossier(s,{booking:'private.fixture',section:'notes',values:{notes:'Eigen'}},d);await writeReishuis(s,0);await writeDossierSnapshot('private.fixture',{data:d,version:'one',syncedAt:100});await writeDossierSnapshot('private.fixture',{data:{},version:'old',syncedAt:50});initReishuis({sqlite});assert.equal((await readDossierSnapshot('private.fixture')).version,'one');assert.equal((await readReishuis()).state.dossiers['private.fixture'].notes.notes,'Eigen');await assert.rejects(writeReishuis(s,0),{status:409});sqlite.close();
});
test('dossier cache shares cold reads and preserves last successful source on failed refresh',async()=>{
 let saved,calls=0,now=1,fail=false;const cache=createDossierCache({clock:()=>now,readSnapshot:async()=>saved,writeSnapshot:async(id,v)=>{saved=v;},fetchDossier:async()=>{calls++;if(fail)throw Error('DO NOT LEAK');return source();}});
 await Promise.all(Array.from({length:15},()=>cache.get('private.fixture')));assert.equal(calls,1);now=70000;fail=true;assert.equal((await cache.get('private.fixture')).stale,true);await new Promise(r=>setImmediate(r));const last=await cache.get('private.fixture');assert.equal(last.data.notes,'Bronnotitie');assert.equal(last.syncFailed,true);assert.equal(calls,2);
});
test('dossier endpoints enforce auth, origin, CSRF, source version and edit revision without exposing detail on dashboard',async()=>{
 let allowed=true,state=emptyReishuis(),revision=0,details=0,saved;
 const h=createReishuisHandler({origin:'https://example.test',authenticate:async()=>allowed,actor:async()=> 'fixture',read:async()=>({revision,state:structuredClone(state)}),write:async s=>{state=s;return ++revision;},readSnapshot:async()=>null,writeSnapshot:async()=>{},fetchBookings:async()=>[{id:'private.fixture',index:'1',name:'Fictief',status:'te verwerken'}],readDossier:async()=>saved,writeDossier:async(id,v)=>{saved=v;},fetchDossier:async()=>{details++;return source();}});
 async function req(path,method='GET',data,headers={}){const r=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);r.method=method;r.headers={cookie:'tr_google_session=fixture',...headers};let status,body;await h(r,{setHeader(){},writeHead(s){status=s;},end(b){body=b;}},new URL('https://example.test/seinhuis/reishuis'+path));return {status,data:JSON.parse(body)};}
 allowed=false;for(const path of ['/api/dossier?id=private.fixture','/reishuis-dossier-ui.js','/reishuis-dossier.mjs'])assert.equal((await req(path)).status,403);assert.equal(details,0);allowed=true;
 const dashboard=await req('/api/state');assert.equal(details,0);assert.ok(!JSON.stringify(dashboard).includes('Voorbeeldstraat'));assert.equal(dashboard.data.dossiers,undefined);
 assert.equal((await req('/api/dossier?id=missing')).status,404);assert.equal(details,0);
 const d=await req('/api/dossier?id=private.fixture');assert.equal(d.status,200);assert.equal(details,1);assert.equal(d.data.dossier.personal.address,'Voorbeeldstraat 1');
 const input={action:'dossier',booking:'private.fixture',section:'notes',values:{notes:'Eigen'},revision:0,sourceVersion:d.data.sourceVersion,source:{notes:'FORGED'}};
 const valid={origin:'https://example.test','content-type':'application/json','x-reishuis-csrf':dashboard.data.csrf};
 assert.equal((await req('/api/change','POST',input,{})).status,403);assert.equal((await req('/api/dossier?id=private.fixture','GET',undefined,{origin:'https://evil.test'})).status,403);
 assert.equal((await req('/api/change','POST',{...input,sourceVersion:'stale'},valid)).status,409);
 assert.equal((await req('/api/change','POST',input,valid)).status,200);assert.equal(saved.data.notes,'Bronnotitie');assert.equal(state.dossiers['private.fixture'].notes.notes,'Eigen');assert.equal((await req('/api/change','POST',input,valid)).status,409);
 assert.equal((await req('/api/dossier?id=private.fixture')).data.dossier.notes,'Eigen');allowed=false;assert.equal((await req('/api/dossier?id=private.fixture')).status,403);
});
