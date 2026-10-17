import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {fetchReishuisBookings,selectRows,dayInAmsterdam,imageURL,defaultRows,normalizeStatus} from './reishuis-data.mjs';
import {createReishuisHandler,applyChange} from './reishuis.mjs';
import {emptyReishuis,initReishuis,readReishuis,writeReishuis} from './reishuis-store.mjs';
import {googleHasScope} from './google-access-state.mjs';

const booking=(i=1)=>({id:'private.fixture-'+i,index:String(i),name:'Fictieve Reiziger '+i,status:'te verwerken',departure:'2026-10-17',return:'2026-10-18',created:'2026-10-'+String(i).padStart(2,'0'),photo:null});
test('role requires explicit grant even for admin and denies legacy role shortcuts',()=>{
 for(const session of [null,{role:'admin',apps:[]},{role:'user',apps:['flora','booklets','treinhuis']}])assert.equal(googleHasScope(session,'reishuis'),false);
 for(const role of ['admin','user'])assert.equal(googleHasScope({role,apps:['reishuis']},'reishuis'),true);
 assert.equal(googleHasScope({role:'admin',apps:[]},'flora'),true);
});
test('five-card paging, search, ordering and inclusive Amsterdam dates',()=>{
 const list=Array.from({length:12},(_,i)=>booking(i+1));let rows=selectRows(list);assert.equal(rows.length,5);assert.equal(rows[0].bookings.length,5);assert.equal(rows[0].bookings[0].index,'12');
 rows=selectRows(list,defaultRows,[1]);assert.equal(rows[0].bookings[0].index,'7');assert.equal(selectRows(list,defaultRows,[],'12')[0].total,1);
 const travelling={...booking(),status:'afgehandeld'};assert.equal(selectRows([travelling],defaultRows,[],'','2026-10-17')[4].total,1);assert.equal(selectRows([travelling],defaultRows,[],'','2026-10-18')[4].total,1);assert.equal(selectRows([travelling],defaultRows,[],'','2026-10-19')[4].total,0);
 assert.equal(dayInAmsterdam(new Date('2026-10-16T22:30:00Z')),'2026-10-17');
 assert.equal(normalizeStatus('wacht klant'),'wacht op reactie klant');
 assert.equal(normalizeStatus('Wacht op reactie van klant'),'wacht op reactie klant');
});
test('Sanity reads page by page using GET only; draft override and narrow photo projection',async()=>{
 let n=0;const all=await fetchReishuisBookings({config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{
  assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.searchParams.get('perspective'),'raw');assert.match(u.searchParams.get('query'),/coalesce\(trip->imagesWithData\[0\]->image.asset->url,trip->imagesWithData\[0\]\.image.asset->url\)/);assert.doesNotMatch(u.searchParams.get('query'),/documents|passengers|notes/);
  n++;return {ok:true,json:async()=>({result:n===1?Array.from({length:100},(_,i)=>({_id:'a'+String(i).padStart(3,'0'),index:i,firstName:'Fictief'})):[{_id:'drafts.a000',index:0,firstName:'Concept'}]})};
 }});assert.equal(n,2);assert.equal(all.length,100);assert.equal(all.find(b=>b.id==='a000').name,'Concept');assert.equal(imageURL('https://evil.test/image.jpg'),null);assert.equal(imageURL('https://cdn.sanity.io/files/il9cyh3m/production/anything.pdf'),null);
});
const request=async(handler,path='/api/state',{method='GET',headers={},data}={})=>{
 const req=Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.headers={cookie:'tr_google_session=fixture-session',...headers};let status,body;const out={};
 await handler(req,{setHeader:(k,v)=>out[k]=v,writeHead:(s,h)=>{status=s;Object.assign(out,h);},end:b=>body=b},new URL('https://example.test/seinhuis/reishuis'+path));
 return {status,body,headers:out,json:()=>JSON.parse(body)};
};
test('auth protects every page, API, photo, file, unknown path and method before data access',async()=>{
 let calls=0;const h=createReishuisHandler({authenticate:async()=>false,read:async()=>{calls++;},fetchBookings:async()=>{calls++;}});
 for(const path of ['/','/reishuis.js','/reishuis.css','/api/state','/api/photo?id=x','/api/change','/missing'])for(const method of ['GET','POST','HEAD']){const r=await request(h,path,{method});assert.equal(r.status,403);assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.headers['Referrer-Policy'],'no-referrer');assert.ok(!String(r.body).includes('Fictief'));}assert.equal(calls,0);
});
test('CSRF binds token to session, origin, JSON and same-origin fetch metadata',async()=>{
 let state=emptyReishuis(),revision=0;const h=createReishuisHandler({origin:'https://example.test',authenticate:async()=>true,actor:async()=> 'fixture-user',read:async()=>({revision,state:structuredClone(state)}),write:async(s)=>{state=s;return ++revision;},fetchBookings:async()=>[booking()]});
 const first=await request(h);assert.equal(first.status,200);const token=first.json().csrf;
 const data={revision:0,action:'customer',name:'Fictieve Klant'};
 const valid={origin:'https://example.test','content-type':'application/json','x-reishuis-csrf':token};
 for(const headers of [{...valid,origin:'https://evil.test'},{...valid,'x-reishuis-csrf':'wrong'},{...valid,cookie:'tr_google_session=other'},{...valid,'content-type':'text/plain'},{...valid,'sec-fetch-site':'cross-site'}])assert.equal((await request(h,'/api/change',{method:'POST',headers,data})).status,403);
 assert.equal((await request(h,'/api/change',{method:'POST',headers:valid,data})).status,200);assert.equal(state.customers.length,1);
 assert.equal((await request(h,'/api/change',{method:'POST',headers:valid,data})).status,409);
 assert.equal((await request(h,'/api/state',{headers:{origin:'https://evil.test'}})).status,403);
});
test('customer ambiguity, occupied links, explicit merge, preserved notes and history',()=>{
 const s=emptyReishuis(),list=[booking()];s.customers=[{id:'one',name:'Fictieve Een'},{id:'two',name:'Fictieve Twee'}];
 assert.throws(()=>applyChange(s,{action:'customer',name:'Fictieve Een'},list,'fixture'),{status:409});
 applyChange(s,{action:'link',booking:list[0].id,customer:'one'},list,'fixture');assert.throws(()=>applyChange(s,{action:'link',booking:list[0].id,customer:'two'},list,'fixture'),{status:409});
 s.notes['customer:one']='Notitie A';s.notes['customer:two']='Notitie B';
 assert.throws(()=>applyChange(s,{action:'merge',from:'one',to:'two',confirm:true,confirmName:'wrong'},list,'fixture'));
 applyChange(s,{action:'merge',from:'one',to:'two',confirm:true,confirmName:'Fictieve Twee'},list,'fixture');assert.equal(s.links[list[0].id],'two');assert.equal(s.customers.length,1);assert.match(s.notes['customer:two'],/Notitie B\n\nNotitie A/);assert.equal(s.history.at(-1).action,'merge');
 assert.throws(()=>applyChange(s,{action:'link',booking:'__proto__',customer:'two'},list,'fixture'));
});
test('persistent store rejects stale revisions and survives reopening adapter',async()=>{
 const sqlite=new DatabaseSync(':memory:');initReishuis({sqlite});const s=emptyReishuis();s.customers.push({id:'fixture',name:'Fictieve Klant'});await writeReishuis(s,0);await assert.rejects(writeReishuis(emptyReishuis(),0),{status:409});initReishuis({sqlite});assert.equal((await readReishuis()).state.customers.length,1);sqlite.close();
});
test('photo proxy never follows redirects or forwards Sanity credentials; bounded files',async()=>{
 const h=createReishuisHandler({authenticate:async()=>true,fetchBookings:async()=>[{...booking(),photo:'https://cdn.sanity.io/images/il9cyh3m/production/abc-100x100.jpg'}],fetcher:async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);return {ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:Readable.from([Buffer.from('fixture-image')])};}});
 const r=await request(h,'/api/photo?id='+booking().id);assert.equal(r.status,200);assert.equal(r.headers['Content-Type'],'image/jpeg');assert.equal((await request(h,'/api/photo?id=unknown')).status,404);
});
