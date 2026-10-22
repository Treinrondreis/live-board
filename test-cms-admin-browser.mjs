import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {startCmsAdminPreview} from './test-fixtures/cms-admin-preview.mjs';
const preview=await startCmsAdminPreview();let browser;
try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{if(new URL(route.request().url()).origin!==preview.origin){external.push(route.request().url());await route.abort();}else await route.continue();});
  await page.goto(preview.origin+'/seinhuis/treinreiziger');await page.locator('#pages button').first().waitFor({state:'attached'});
  await page.getByRole('button',{name:'Concept opslaan',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#save').disabled);
  await page.getByText('Andere onderdelen',{exact:true}).click();
  assert.equal(await page.getByRole('navigation',{name:'Onderdelen',exact:true}).getByRole('link',{name:'Treinreiziger',exact:true}).getAttribute('aria-current'),'page');
  await page.getByText('Andere onderdelen',{exact:true}).click();
  await page.getByRole('heading',{name:'Overzicht',exact:true}).waitFor();
  if(process.env.CMS_ADMIN_SCREENSHOTS){await mkdir(process.env.CMS_ADMIN_SCREENSHOTS,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(process.env.CMS_ADMIN_SCREENSHOTS,'treinreiziger-overzicht.png')});}
  const menu=page.getByRole('navigation',{name:'Menu Treinreiziger',exact:true});
  await menu.getByRole('link',{name:'Pagina’s',exact:true}).click();
  for(const width of [1440,1024]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>({editor:document.querySelector('#editor').getBoundingClientRect().toJSON(),list:document.querySelector('.cms-pages').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.ok(layout.editor.top<300,'editor starts near the top at '+width);
    assert.ok(Math.abs(layout.editor.top-layout.list.top)<2&&layout.editor.left>=layout.list.right,'page list stays beside the editor at '+width);
    assert.equal(layout.overflow,false,'no laptop horizontal overflow');
  }
  await page.setViewportSize({width:1440,height:1050});
  const title=page.locator('[data-scope="page"] input[data-key="title"]');await title.fill('Gewijzigd voorbeeld');
  await menu.getByRole('link',{name:'Appnavigatie',exact:true}).click();await page.locator('#main-menu input[data-key="title"]').first().fill('Voorbeeldmenu');
  await menu.getByRole('link',{name:'Pagina’s',exact:true}).click();assert.equal(await title.inputValue(),'Gewijzigd voorbeeld','view changes preserve unsaved editor values');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  await page.getByRole('button',{name:'Concept opslaan',exact:true}).click();await page.locator('#message').getByText('Concept opgeslagen.',{exact:true}).waitFor();
  assert.equal(await page.locator('#message').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'save feedback stays visible while editing a long page');
  let stored=await preview.read();assert.equal(stored.value.draft.pages[0].title,'Gewijzigd voorbeeld');assert.equal(stored.value.draft.navigation[0].title,'Voorbeeldmenu');assert.equal(stored.value.published.pages[0].title,'Voorbeeldnieuws','draft save does not publish');
  await menu.getByRole('link',{name:'Feeds en bronnen',exact:true}).click();await page.locator('#cms-sources').getByText('Gewijzigd voorbeeld · onderdeel 1',{exact:true}).waitFor();
  await page.locator('#cms-sources').getByRole('button',{name:'Pagina bewerken',exact:true}).first().click();assert.equal(await title.inputValue(),'Gewijzigd voorbeeld');
  await page.getByRole('button',{name:'Voorbeeld bekijken',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.locator('#preview-frame').getAttribute('src'),/^\/app\/\?preview=1#nieuws$/);await page.getByRole('button',{name:'Sluiten',exact:true}).click();
  await page.getByRole('button',{name:'Publiceren',exact:true}).click();await page.locator('#message').getByText('Gepubliceerd.',{exact:false}).waitFor();stored=await preview.read();assert.equal(stored.value.published.pages[0].title,'Gewijzigd voorbeeld');assert.equal(stored.value.previous.pages[0].title,'Voorbeeldnieuws');
  await page.getByText('Meer acties',{exact:true}).click();await page.getByRole('button',{name:'Vorige publicatie als concept',exact:true}).click();assert.equal(await title.inputValue(),'Voorbeeldnieuws');
  assert.equal((await preview.read()).value.published.pages[0].title,'Gewijzigd voorbeeld','restoring only changes the in-memory draft until saving');
  if(process.env.CMS_ADMIN_SCREENSHOTS){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(process.env.CMS_ADMIN_SCREENSHOTS,'treinreiziger-editor.png')});}
  // A concurrent save still fails instead of replacing another edit.
  await context.request.post(preview.origin+'/api/app-content/save',{headers:{Origin:preview.origin},data:{revision:stored.revision,draft:stored.value.draft}});
  await page.getByRole('button',{name:'Concept opslaan',exact:true}).click();await page.locator('#message').getByText('De inhoud is elders gewijzigd.',{exact:false}).waitFor();
  for(const width of [850,390,320]){
    await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow at '+width);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    const toggle=page.getByRole('button',{name:'Menu',exact:true});await toggle.click();
    assert.equal(await menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight&&r.bottom<=innerHeight+1;}),true,'mobile menu remains on screen after scrolling');
    await menu.getByRole('link',{name:'Appnavigatie',exact:true}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#cms-main').evaluate(e=>e===document.activeElement),true);
    await toggle.click();await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await toggle.click();await menu.getByRole('link',{name:'Pagina’s',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('.cms-pages').evaluate(e=>e.open),false,'mobile page list starts collapsed');
    const editorTop=await page.locator('#editor').evaluate(e=>e.getBoundingClientRect().top);
    assert.ok(editorTop<470,'mobile editor is visible without scrolling past the page list at '+width+': '+editorTop);
    await page.locator('.cms-pages summary').click();await page.locator('#pages button').first().click();
    assert.equal(await page.locator('.cms-pages').evaluate(e=>e.open),false,'choosing a mobile page returns space to the editor');
  }
  if(process.env.CMS_ADMIN_SCREENSHOTS){await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Menu',exact:true}).click();await menu.getByRole('link',{name:'Overzicht',exact:true}).click();await page.screenshot({path:join(process.env.CMS_ADMIN_SCREENSHOTS,'treinreiziger-mobiel.png')});}
  const failed=await context.newPage();failed.on('pageerror',e=>errors.push(e.message));await failed.setViewportSize({width:390,height:844});
  await failed.route('**/api/app-content/draft',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fictieve laadfout'})}));
  await failed.goto(preview.origin+'/seinhuis/treinreiziger');await failed.locator('#message').getByText('Fictieve laadfout',{exact:true}).waitFor();
  await failed.getByRole('button',{name:'Menu',exact:true}).click();await failed.getByRole('navigation',{name:'Menu Treinreiziger',exact:true}).getByRole('link',{name:'Pagina’s',exact:true}).click();
  assert.equal(await failed.locator('#reload').isDisabled(),false);assert.equal(await failed.locator('#save').isDisabled(),true);assert.equal(await failed.locator('#add-page').isDisabled(),true);await failed.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const writes=preview.requests.filter(r=>r.method==='POST');assert.ok(writes.length>0);assert.equal(writes.every(r=>['/api/app-content/save','/api/app-content/publish'].includes(r.path)),true);
  console.log('PASS Treinreiziger beheer: module/context navigation, draft persistence, navigation edits, feed links, preview, publication, restore, conflict and responsive layouts');
}finally{await browser?.close();await preview.close();}
