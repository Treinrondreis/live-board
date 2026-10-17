import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createAdminUiPreview} from './scripts/preview-admin-ui.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=createAdminUiPreview();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push({origin:new URL(r.url()).origin,method:r.method()}));
  await page.goto(origin);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.fonts.check('600 16px "TR Montserrat"')),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('.tr-skip').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Enter');assert.equal(await page.locator('#inhoud').evaluate(e=>e===document.activeElement),true);
  await page.getByRole('searchbox').fill('boekje');await page.locator('#result-count').getByText('1 voorbeeld',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('alarm');await page.locator('#empty').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Filters wissen'}).click();assert.equal(await page.locator('#result-count').innerText(),'3 voorbeelden');
  await page.getByRole('button',{name:'Bekijken',exact:true}).first().click();await page.locator('#example-detail').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Compacte weergave'}).click();assert.equal(await page.locator('#density').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Voorbeeld opslaan'}).click();assert.match(await page.locator('#save-feedback').innerText(),/geen gegevens opgeslagen/);
  if(process.env.ADMIN_UI_SCREENSHOTS){await mkdir(process.env.ADMIN_UI_SCREENSHOTS,{recursive:true});await page.goto(origin);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(process.env.ADMIN_UI_SCREENSHOTS,'stijlbasis-desktop.png'),fullPage:true});await page.screenshot({path:join(process.env.ADMIN_UI_SCREENSHOTS,'stijlbasis-overzicht.png')});}
  for(const width of [850,390,320]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow at '+width);
    const toggle=page.getByRole('button',{name:'Onderdelen',exact:true});await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await page.getByRole('navigation').getByRole('link',{name:'FloRA',exact:true}).focus();await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(e=>e===document.activeElement),true);
    await toggle.click();await page.getByRole('navigation').getByRole('link',{name:'FloRA',exact:true}).click();
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#statussen').evaluate(e=>e===document.activeElement),true);
    assert.equal(await toggle.evaluate(e=>e.getBoundingClientRect().height>=44),true);
  }
  if(process.env.ADMIN_UI_SCREENSHOTS){await page.setViewportSize({width:390,height:844});await page.goto(origin);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(process.env.ADMIN_UI_SCREENSHOTS,'stijlbasis-mobiel.png'),fullPage:true});}
  assert.deepEqual(errors,[]);assert.equal(requests.every(r=>r.origin===origin&&r.method==='GET'),true,'local assets only, no writes');
  // Loading the library must not change an existing screen outside its opt-in root.
  const isolated=await browser.newPage();await isolated.goto(origin);
  await isolated.setContent('<button id="outside">Bestaande knop</button><div class="tr-ui"><button class="tr-button">Nieuwe knop</button></div>');
  const before=await isolated.locator('#outside').evaluate(e=>({font:getComputedStyle(e).font,padding:getComputedStyle(e).padding,background:getComputedStyle(e).backgroundColor}));
  await isolated.addStyleTag({url:origin+'/tokens.css'});await isolated.addStyleTag({url:origin+'/components.css'});
  const after=await isolated.locator('#outside').evaluate(e=>({font:getComputedStyle(e).font,padding:getComputedStyle(e).padding,background:getComputedStyle(e).backgroundColor}));assert.deepEqual(after,before);
  console.log('PASS shared admin UI: contrast covered by unit tests; keyboard, filters, mobile menu, responsive width, no external requests and scoped styles');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
