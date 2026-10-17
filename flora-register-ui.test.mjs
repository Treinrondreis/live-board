import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('standalone list escapes source fields, filters and clears data on failure',async()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false});return nodes.get(id);};
 const state={configured:true,available:true,legs:[{dossier:'DEMO-<script>',booking_key:'Fictief',travel_date:'2031-06-10',arrival_date:'2031-06-11',train_number:'TEST 999',from_station:'<img onerror="alert(1)">',to_station:'Fictional South',role:'backup',document_url:'javascript:alert(1)'}]};
 let fail=false;
 runInNewContext(await readFile(new URL('./reisschemas.js',import.meta.url),'utf8'),{document:{getElementById:get},URL,fetch:async url=>{assert.equal(url,'/seinhuis/reisschemas/api/register');if(fail)throw Error('private detail');return {ok:true,json:async()=>state};}});
 await get('refresh').onclick();
 const html=get('register').innerHTML;assert.match(html,/DEMO-&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script>|<img|href="javascript:/);assert.match(html,/Back-up/);assert.match(html,/Geen documentlink/);
 get('search').value='does-not-match';get('search').oninput();assert.match(get('summary').textContent,/0 ritten/);
 get('search').value='10-06-2031';get('search').oninput();assert.match(get('summary').textContent,/1 ritten/);
 fail=true;await get('refresh').onclick();assert.equal(get('register').innerHTML,'');assert.doesNotMatch(get('summary').textContent,/private detail/);
});
