import assert from 'node:assert/strict';
import http from 'node:http';
import {mock} from 'node:test';
mock.module('./admin-security.mjs',{namedExports:{adminAuthenticated:async()=>false}});
const {createBookletsGateway,BOOKLETS_PREFIX:p}=await import('./booklets-gateway.mjs');
const id='a'.repeat(32),other='b'.repeat(32),session='1900000000.'+'c'.repeat(64),seen=[];
const backend=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{seen.push({url:req.url,headers:req.headers,body});res.setHeader('Content-Type','application/json');res.setHeader('Set-Cookie',['admin=unsafe; Path=/; HttpOnly; Secure; SameSite=Strict',`trr_reis_${id}=${session}; Max-Age=60; Path=${p}/reis/${id}; HttpOnly; Secure; SameSite=Strict`]);res.end(JSON.stringify({ok:true}));});});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const secret='s'.repeat(48),origin='https://treinbord.up.railway.app';
const gateway=createBookletsGateway({authenticate:async req=>req.headers.cookie==='owner=valid',configuration:()=>({upstream:`http://127.0.0.1:${backend.address().port}`,secret,origin})});
const front=http.createServer(async(req,res)=>{if(!await gateway(req,res,new URL(req.url,'http://test')))res.writeHead(404).end();});
await new Promise(r=>front.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${front.address().port}`,url=base+p+'/reis/'+id;
try{
 const loginPage=await fetch(url);assert.equal(loginPage.status,200);assert.equal(loginPage.headers.get('cache-control'),'no-store');assert.equal(loginPage.headers.get('referrer-policy'),'no-referrer');assert.match(loginPage.headers.get('x-robots-tag'),/noindex/);assert.equal(loginPage.headers.get('set-cookie'),null);assert.equal(seen.at(-1).url,'/internal/travel-sites/'+id);assert.equal(seen.at(-1).headers['x-booklets-gateway'],secret);
 await fetch(url+'/data',{headers:{cookie:`owner=invalid; trr_reis_${id}=${session}; trr_reis_${other}=other`,'x-travel-site-owner':'1','x-booklets-gateway':'attacker'}});
 assert.equal(seen.at(-1).headers['x-travel-site-owner'],undefined);assert.equal(seen.at(-1).headers.cookie,undefined);assert.equal(seen.at(-1).headers['x-travel-site-session'],session);assert.equal(seen.at(-1).headers['x-booklets-gateway'],secret);
 await fetch(url+'/data',{headers:{cookie:'owner=valid'}});assert.equal(seen.at(-1).headers['x-travel-site-owner'],'1');
 const headers={origin,'x-travel-site':'1','content-type':'application/json'};
 const accepted=await fetch(url+'/login',{method:'POST',headers,body:JSON.stringify({code:'FICTIONAL1'})});assert.equal(accepted.status,200);assert.equal(accepted.headers.getSetCookie().length,1);assert(accepted.headers.getSetCookie()[0].startsWith('trr_reis_'+id+'='));assert(!accepted.headers.getSetCookie()[0].includes('admin='));
 const count=seen.length;
 for(const suffix of ['/../api/state','/chapter/../../api/state','/%2fapi/state','/chapter/9999','/data?code=secret','//data'])assert.notEqual((await fetch(url+suffix)).status,200);
 for(const h of [{...headers,origin:'https://evil.example'},{...headers,'x-travel-site':'0'}])assert.equal((await fetch(url+'/login',{method:'POST',headers:h,body:'{}'})).status,403);
 assert.equal((await fetch(url+'/login',{method:'POST',headers,body:'x'.repeat(513)})).status,413);
 assert.equal((await fetch(url+'/book',{method:'POST',headers,body:'{}'})).status,405);
 assert.equal(seen.length,count);
 assert.equal((await fetch(base+p+'/api/state')).status,401);assert.equal((await fetch(base+p+'/internal/travel-sites/'+id)).status,401);
 console.log('Travel website gateway: scoped customer namespace, CSRF, body limits, owner isolation and site-only cookies passed');
}finally{front.closeAllConnections();backend.closeAllConnections();await Promise.all([new Promise(r=>front.close(r)),new Promise(r=>backend.close(r))]);}
