import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const now=new Date().toISOString();
 let failed=false;
 const train={number:'99901',from:'Voorbeeld A',to:'Voorbeeld B',station:'Utrecht Centraal',delay:7,delayKind:'current',phaseLabel:'In Nederland (verwacht)',evidence:{kind:'forecast',station:'Voorbeeld halte',timestamp:now,ageMinutes:0,current:true},messageAt:now,stops:[],position:{kind:'estimated',coordinates:[5.1,52.1],label:'Geschatte positie',basis:'Rechte lijn tussen vertrekverwachtingen'}};
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='tile.openstreetmap.org')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d9e5df"/></svg>'});
  if(url.pathname==='/api/ice-radar')return failed?route.fulfill({status:503}):route.fulfill({json:{generatedAt:now,total:2,trains:[train,{...train,number:'99902',position:{...train.position,kind:'station',coordinates:[5.9,51.98],label:'Stationsmelding'}}]}});
  const file=url.pathname==='/maurits'?'ice-radar.html':url.pathname.slice(1);
  if(!/^(ice-radar\.(html|css|js)|vendor\/leaflet\/leaflet\.(css|js))$/.test(file))return route.abort();
  return route.fulfill({contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html',body:await readFile(new URL(`public/${file}`,import.meta.url))});
 });
 await page.goto('http://radar.test/maurits');
 await page.locator('.ice-marker.estimated').waitFor();
 assert.equal(await page.locator('.train').count(),2);
 assert.equal(await page.locator('.station-report').count(),0);
 assert.match(await page.locator('.evidence').first().textContent(),/Vertrekverwachting Voorbeeld halte/);
 await page.locator('.ice-marker.estimated').click();
 assert.match(await page.locator('.leaflet-popup-content').textContent(),/Geschatte positie/);
 await page.locator('.train').first().click();
 assert.equal(await page.locator('.stops').first().isHidden(),false);
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 failed=true;
 await page.reload();
 await page.getByText('Geen actuele gegevens bereikbaar.',{exact:false}).waitFor();
 assert.equal(await page.locator('.ice-marker').count(),0);
 assert.equal(await page.locator('.train').count(),0);
 console.log('ICE radar browser: map, position labels, details, mobile and unavailable feed passed');
}finally{await browser.close();}
