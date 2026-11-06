import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {reportSelection,buildTrainReport} from './train-report.mjs';

const browser=await chromium.launch(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://report.test/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/treinrapport'){
      const filters=Object.fromEntries(u.searchParams);requests.push(filters);
      const selection=reportSelection(filters,Date.parse('2026-11-07T11:00:00Z'));
      const data=buildTrainReport(selection,[]);
      data.rows[0].cells=data.rows[0].cells.map((c,i)=>({...c,status:'measured',delay:[15,30,59,60,0,8,16][i],station:selection.station,source:selection.source,observedAt:Date.parse('2026-11-06T14:00:00Z'),kind:'expected'}));
      data.rows[1].cells[0]={number:data.rows[1].cells[0].number,status:'cancelled'};
      if(filters.group==='frankfurt-east')data.rows[0].cells[1].eventMode='departure';
      if(filters.group==='swiss')await new Promise(resolve=>setTimeout(resolve,80));
      return route.fulfill({json:data});
    }
    const file='public'+(u.pathname==='/treinrapport'?'/train-report.html':u.pathname);
    return route.fulfill({contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file,'utf8')});
  });
  await page.goto('https://report.test/treinrapport');
  await page.locator('section').last().locator('table').waitFor();
  assert.equal(await page.locator('section').count(),7);
  assert.equal(await page.locator('section').nth(2).locator('tbody tr').first().locator('td').nth(1).locator('.fallback').textContent(),'V');
  const first=page.locator('section').first();
  assert.equal(await first.locator('tbody tr').count(),30);
  assert.equal(await first.locator('tbody tr').first().locator('.good').textContent(),'+15');
  assert.equal(await first.locator('tbody tr').first().locator('.warn').textContent(),'+30');
  assert.equal(await first.locator('tbody tr').first().locator('.bad').textContent(),'+59');
  assert.equal(await first.locator('tbody tr').first().locator('.severe').textContent(),'+60');
  assert.equal(await first.locator('.cancel').textContent(),'✕');
  assert.equal(await first.locator('tbody tr').nth(2).locator('td').first().textContent(),'?');
  await first.getByRole('combobox',{name:/^Bron/}).selectOption('NDOV');
  await first.locator('.status').filter({hasText:'NDOV'}).waitFor();
  await first.getByRole('combobox',{name:/^Aantal dagen/}).selectOption('90');
  await first.locator('tbody tr').nth(89).waitFor();
  assert.equal(requests.at(-1).source,'NDOV');assert.equal(requests.at(-1).days,'90');
  await first.getByRole('combobox',{name:/^Meetstation/}).selectOption('Hengelo');
  await first.getByRole('button',{name:/Hengelo/}).first().waitFor();
  await page.waitForURL(/station=Hengelo/);
  await first.locator('.value').first().click();assert.match(await first.locator('.detail').textContent(),/Hengelo/);
  const single=page.locator('section').nth(4);const width=await single.locator('table').evaluate(el=>el.getBoundingClientRect().width);assert.ok(width<320);
  const last=page.locator('section').last(),anchor=last.locator('.section-head');
  await anchor.evaluate(el=>el.scrollIntoView({block:'start'}));
  for(const [name,value] of [[/^Meetstation/,'Düsseldorf Hbf'],[/^Bron/,'NDOV'],[/^Aantal dagen/,'90'],[/^Aantal dagen/,'60'],[/^Aantal dagen/,'30']]){
    const before=await anchor.evaluate(el=>el.getBoundingClientRect().top);
    await last.getByRole('combobox',{name}).selectOption(value);
    await last.locator('.matrix:not([aria-busy])').waitFor();
    const after=await anchor.evaluate(el=>el.getBoundingClientRect().top);
    assert.ok(Math.abs(after-before)<3,`Changing ${name} moved the page by ${after-before}px`);
  }
  if(process.env.REPORT_SCREENSHOT)await page.screenshot({path:process.env.REPORT_SCREENSHOT});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS groups, colours, departure marker, filters, details, compact/mobile layout and scroll position for station/source/30/60/90 days');
}finally{await browser.close();}
