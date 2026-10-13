import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {chromium} from 'playwright';
const origin='https://example.test',time=Date.now(),errors=[],requests=[];
const browser=await chromium.launch({headless:true,...(process.env.SEINHUIS_TEST_CHROME?{executablePath:process.env.SEINHUIS_TEST_CHROME}:{})});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 let state={configured:true,authenticated:true,isAdmin:true,legacyOwner:false,identity:'hildebrand@treinreiziger.nl',sessionDays:30},device={id:'device',email:'tickets@treinrondreis.nl',label:'Tickets laptop',status:'pending',created:time,lastSeen:time,browser:'Chrome Windows',location:{country:'NL',city:'Rotterdam',ip:'192.0.2.1'}};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path.startsWith('/api/seinhuis-access/')){
   const action=path.split('/').at(-1);requests.push({action,body:route.request().postDataJSON()});if(action==='permissions')assert.deepEqual(route.request().postDataJSON().apps,['stations','booklets','flora']);
   let data=action==='status'?state:action==='overview'?{appScopes:{stations:'Stationschef',treinhuis:'Treinhuis (KM-trein)',treinreiziger:'Treinreiziger',booklets:'Boekjesmaker',flora:'FloRA'},accounts:[{email:'hildebrand@treinreiziger.nl',role:'admin',active:true,linked:true,apps:[]},{email:'reservations@treinrondreis.nl',role:'admin',active:true,linked:false,apps:[]},{email:'tickets@treinrondreis.nl',role:'user',apps:['booklets','flora'],active:true,linked:true},{email:'florentina.niculae@treinrondreis.nl',role:'user',apps:['booklets','flora'],active:true,linked:false}],devices:[device],sessions:[{id:'session',email:device.email,device:device.id,created:time,lastSeen:time,expires:time+30*86400000}],audit:[]}:{ok:true};
   if(action==='approve')device.status='approved';if(action==='revoke'){device.status='revoked';}if(action==='overview'&&device.status==='revoked')data.sessions=[];
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }
  const file=({'/seinhuis/toegang':'google-access.html','/seinhuis/toegang.js':'google-access.js','/seinhuis/toegang.css':'google-access.css','/admin-security.css':'admin-security.css'})[path];
  return route.fulfill({status:file?200:404,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:file?await readFile(file,'utf8'):''});
 });
 await page.goto(origin+'/seinhuis/toegang');await page.getByRole('heading',{name:'Accounts en apparaten',exact:true}).waitFor();
 const rights=page.getByRole('group',{name:'Onderdelen voor tickets@treinrondreis.nl',exact:true});await rights.getByRole('checkbox',{name:'Stationschef',exact:true}).check();await rights.getByRole('button',{name:'Onderdeelrechten opslaan',exact:true}).click();await page.getByText('Onderdeelrechten opgeslagen.',{exact:false}).waitFor();assert.ok(requests.some(v=>v.action==='permissions'));
 await page.getByRole('button',{name:'Goedkeuren',exact:true}).click();await page.getByRole('button',{name:'Intrekken',exact:true}).waitFor();assert.equal(device.status,'approved');
 await page.getByRole('button',{name:'Intrekken',exact:true}).click();await page.getByRole('button',{name:'Goedkeuren',exact:true}).waitFor();assert.equal(device.status,'revoked');assert.ok(requests.some(v=>v.action==='revoke'&&v.body.id==='device'));
 await mkdir('outputs',{recursive:true});await page.screenshot({path:'outputs/google-access-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/google-access-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
 state={configured:true,authenticated:false,isAdmin:false,legacyOwner:false,device:{email:device.email,status:'pending',label:device.label}};await page.reload();await page.getByRole('heading',{name:'Wachten op goedkeuring',exact:true}).waitFor();assert.equal(await page.locator('#admin').isVisible(),false);
 state.device.status='revoked';await page.reload();await page.getByRole('heading',{name:'Toegang ingetrokken',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Goedkeuring controleren'}).isVisible(),false);
 state={configured:true,authenticated:false,isAdmin:true,legacyOwner:true};await page.reload();await page.getByRole('heading',{name:'Je eerste Google-beheerdersaccount koppelen',exact:true}).waitFor();assert.equal(await page.locator('#code-label').isVisible(),true);
 assert.deepEqual(errors,[]);console.log('PASS Google access desktop/mobile, approval/revocation controls, pending/revoked views and legacy onboarding');
}finally{await browser.close();}
