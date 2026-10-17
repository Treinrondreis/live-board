import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {startStationschefPreview} from './test-fixtures/stationschef-preview.mjs';
const fixture=await startStationschefPreview();let browser;
try{
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
 for(const [key,title,ready] of [['overzicht','Stationschef','.sc-tiles'],['treinbord','Grote treinbord','#trains tr'],['borden','Vertrekborden beheren','#station-name'],['aansluitingen','Aansluitingen beheren','#rules>details'],['perrons','Perrons en overstaptijden','#name']]){
  await page.goto(fixture.origin+'/stationschef'+(key==='overzicht'?'':'/'+key));await page.locator(ready).waitFor();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await page.locator('main').count(),1,'single main landmark');
  assert.equal(await page.getByRole('navigation',{name:'Menu Stationschef',exact:true}).locator('[aria-current="page"]').count(),1,'one active contextual link');
  if(key==='borden'){
   assert.equal(await page.locator('#message').isVisible(),false,'empty status does not reserve a bar');
   for(const width of [1920,1440,1024]){
    await page.setViewportSize({width,height:1000});
    const layout=await page.evaluate(()=>({preview:document.querySelector('.layout>.preview').getBoundingClientRect().toJSON(),editor:document.querySelector('.layout>section:not(.preview)').getBoundingClientRect().toJSON(),header:document.querySelector('.sc-main>header').getBoundingClientRect().toJSON()}));
    assert.ok(layout.header.bottom<90,'compact header at '+width);
    assert.ok(layout.preview.top<120,'preview starts high at '+width);
    if(width>=1440)assert.ok(layout.preview.width>layout.editor.width*1.4,'preview gets more space than editor at '+width);
    else assert.ok(layout.preview.width>550,'laptop preview uses full content column');
   }
   await page.setViewportSize({width:1440,height:1000});await page.locator('#title').fill('Fictieve wijziging');await page.locator('#save').click();await page.locator('#message.success').waitFor();assert.equal(fixture.state().boards[0].settings.title,'Fictieve wijziging');
  }
  if(key==='aansluitingen'){await page.locator('#add').click();assert.equal(await page.locator('#rules>details').count(),2);await page.locator('#save').click();await page.locator('#message').getByText('Opgeslagen.',{exact:false}).waitFor();assert.equal(fixture.state().rules.rules.length,2);}
  if(key==='perrons'){await page.locator('#groups summary').first().click();await page.locator('[data-field="notes"]').first().fill('Fictieve spooruitleg');await page.locator('#save').click();await page.locator('#saveStatus').getByText('Station opgeslagen',{exact:false}).waitFor();assert.equal(fixture.state().platform.groups[0].notes,'Fictieve spooruitleg');}
  if(key==='treinbord'){await page.locator('#name').fill('Fictief scherm');await page.getByRole('button',{name:'Instellingen opslaan',exact:true}).click();await page.locator('#status').getByText('Opgeslagen',{exact:false}).waitFor();assert.equal(fixture.state().screens[0].settings.name,'Fictief scherm');}
  await page.evaluate(()=>window.scrollTo(0,0));
  if(process.env.STATIONSCHEF_SCREENSHOTS){await mkdir(process.env.STATIONSCHEF_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.STATIONSCHEF_SCREENSHOTS,key+'.png')});}
  for(const width of [1024,850,390,320]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,key+' fits '+width);
   if(width<=850){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.locator('.sc-toggle').click();assert.equal(await page.locator('.sc-sidebar').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1}),true,'menu on screen after scrolling');await page.keyboard.press('Escape');assert.equal(await page.locator('.sc-toggle').getAttribute('aria-expanded'),'false');}
  }
  await page.setViewportSize({width:1440,height:1000});
 }
 assert.deepEqual(errors,[]);assert.ok(fixture.requests.some(r=>r.method==='POST'));
 console.log('PASS Stationschef: all admin views, contextual navigation, mobile/laptop layouts, menu focus, and existing save controls with fictional data');
}finally{await browser?.close();await fixture.close();}
