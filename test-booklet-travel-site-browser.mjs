import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const html=await readFile(new URL('./booklets/travel-site.html',import.meta.url),'utf8'),script=html.split('<script>')[1].split('</script>')[0].replace(/\r\n?/g,'\n');
const policy="default-src 'none'; script-src 'sha256-"+createHash('sha256').update(script).digest('base64')+"'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const prefix='/seinhuis/boekjesmaker/reis/'+'a'.repeat(32),code='ABCDEFGH23';let hostile=false;
const fixture=()=>({title:hostile?'<img src=x onerror="window.injected=1">':'Voorbeeldreis door Europa',created:'2028-05-01T12:00:00Z',chapters:[{title:'Welkom op reis',kind:'informatie',dates:[],text:'Uw reis begint hier.\n\nIn dit persoonlijke reisoverzicht vindt u de documenten en praktische informatie uit uw reisboekje. Bewaar de PDF ook op uw telefoon voor onderweg.'},{title:'Treinreis naar uw bestemming',kind:'tickets',dates:['2028-06-08'],text:''},{title:'Uw hotelverblijf',kind:'hotels',dates:['2028-06-08'],text:'Voorbeeldhotel\nVoorbeeldstraat 12\nInchecken vanaf 15.00 uur.\n\nOpen de voucher voor de volledige reserveringsgegevens.'},{title:'Ontdek uw bestemming',kind:'routes',dates:['2028-06-09'],text:'Neem de tijd om de stad te ontdekken.\n\nDeze informatie komt uit het opgeslagen reisboekje.'}]});
const server=http.createServer((req,res)=>{res.setHeader('Cache-Control','no-store');if(req.url===prefix){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',policy);return res.end(html)}const auth=req.headers.cookie==='fixture=1';if(req.url===prefix+'/login'){let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{res.setHeader('Content-Type','application/json');if(JSON.parse(raw).code!==code){res.writeHead(401);return res.end(JSON.stringify({error:'De toegangscode klopt niet.'}))}res.setHeader('Set-Cookie','fixture=1; Path=/; HttpOnly; SameSite=Strict');res.end('{"ok":true}')});return}if(req.url===prefix+'/logout'){res.setHeader('Set-Cookie','fixture=; Max-Age=0; Path=/');return res.end('{"ok":true}')}if(!auth){res.writeHead(401,{'Content-Type':'application/json'});return res.end('{"error":"Voer uw toegangscode in."}')}if(req.url===prefix+'/data'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(fixture()))}if(req.url===prefix+'/cover'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="550"><rect width="400" height="550" fill="#183c3c"/><path d="M40 190H360M40 220H360M40 250H360" stroke="#c38b43" stroke-width="3"/><text x="40" y="70" fill="white" font-family="sans-serif" font-size="18">TREINRONDREIS</text><text x="40" y="350" fill="white" font-family="sans-serif" font-size="34">Uw reisboekje</text><text x="40" y="395" fill="#cbded5" font-family="sans-serif" font-size="20">Voorbeeldreis</text></svg>')}res.writeHead(404);res.end()});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:1280,height:1050},{width:390,height:1000}]){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`+prefix);await page.getByLabel('Toegangscode').waitFor();assert.equal(await page.getByRole('heading',{name:'Voorbeeldreis door Europa'}).count(),0);
  await page.getByLabel('Toegangscode').fill('WRONGCODE');await page.getByRole('button',{name:'Open mijn reis'}).click();await page.getByText('De toegangscode klopt niet.').waitFor();
  await page.getByLabel('Toegangscode').fill(code);await page.getByRole('button',{name:'Open mijn reis'}).click();await page.getByRole('heading',{name:'Voorbeeldreis door Europa'}).waitFor();assert.equal(await page.locator('article').count(),4);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.TRAVEL_SITE_SHOTS){await mkdir(process.env.TRAVEL_SITE_SHOTS,{recursive:true});await page.screenshot({path:process.env.TRAVEL_SITE_SHOTS+'/'+viewport.width+'.png',fullPage:true})}
  await page.getByRole('button',{name:'Tickets',exact:true}).click();assert.equal(await page.locator('article').count(),1);assert.equal(await page.getByRole('link',{name:'Open tickets (PDF)'}).getAttribute('href'),prefix+'/chapter/1');
  await page.getByRole('button',{name:'Alles',exact:true}).click();await page.getByRole('button',{name:'9 juni 2028',exact:true}).click();assert.equal(await page.getByRole('heading',{name:'Uw hotelverblijf'}).count(),0);assert.equal(await page.getByRole('heading',{name:'Welkom op reis'}).count(),1);
  hostile=true;await page.reload();await page.getByRole('heading',{name:'<img src=x onerror="window.injected=1">',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.injected),undefined);assert.equal(await page.locator('h1 img').count(),0);hostile=false;
  if(viewport.width===390)await page.route('**/logout',route=>route.abort());
  await page.getByRole('button',{name:'Afsluiten'}).click();await page.getByLabel('Toegangscode').waitFor();assert.equal(await page.locator('article').count(),0);
  if(viewport.width===390)await page.getByText(/Afsluiten kon niet worden bevestigd/).waitFor();
  await context.close();assert.deepEqual(errors,[]);
 }
 console.log('Travel website browser: desktop/mobile login, content, filters, links, overflow, XSS and logout passed');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
