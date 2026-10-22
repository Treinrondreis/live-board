import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
mock.module('./admin-security.mjs',{namedExports:{adminAuthenticated:async(req,scope)=>!!req.owner||!!req.scopes?.includes(scope)}});
const {handleAdminHub}=await import('./admin-hub.mjs');
const {handleConnectionAdmin}=await import('./connections-admin.mjs');
const {handlePlatformAdmin}=await import('./platform-admin.mjs');
const {handleScreenSettings}=await import('./screen-settings.mjs');
const handlers=[['/stationschef',handleAdminHub],['/stationschef/aansluitingen',handleConnectionAdmin],['/stationschef/perrons',handlePlatformAdmin],['/stationschef/treinbord',handleScreenSettings]];
async function request(path,handler,scopes){let body='',status=0;const headers={};const handled=await handler({method:'GET',scopes,headers:{host:'example.org'},socket:{}},{setHeader(k,v){headers[k]=v;},writeHead(s){status=s;},end(s=''){body=String(s);}},new URL(path,'https://example.org'));return {status,body,headers,handled};}
test('new Stationschef shell stays behind existing station permissions',async()=>{
 for(const [path,handler] of handlers){
  const denied=await request(path,handler,['treinreiziger']);assert.equal(denied.status,303,path);assert.doesNotMatch(denied.body,/sc-sidebar/);
  const page=await request(path,handler,['stations']);assert.equal(page.status,200,path);assert.match(page.body,/class="sc-ui tr-module-stationschef/);assert.match(page.body,/aria-label="Menu Stationschef"/);assert.match(page.body,/stationschef-workspace.css/);
  const modules=page.body.match(/<nav class="tr-global-nav"[\s\S]*?<\/nav>/)?.[0];assert.ok(modules);assert.match(modules,/Stationschef/);assert.doesNotMatch(modules,/FloRA|KM-trein|Boekjesmaker|Treinreiziger/);
  assert.equal(page.headers['Cache-Control'],'no-store');
 }
});
