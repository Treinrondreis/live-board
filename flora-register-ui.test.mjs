import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('register list escapes source fields and refuses unsafe document links',async()=>{
 const nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,after(node){nodes.set(node.id,node);}});return nodes.get(id);};
 const document={getElementById:get,createElement:()=>({id:'',innerHTML:''}),addEventListener(){}};
 const state={rows:[],connections:[],checks:{},registry:{configured:true,available:true,legs:[{
  dossier:'DEMO-<script>',travel_date:'2031-06-10',arrival_date:'2031-06-11',train_number:'TEST 999',
  from_station:'<img onerror="alert(1)">',to_station:'Fictional South',role:'backup',document_url:'javascript:alert(1)'
 }]}};
 runInNewContext(await readFile(new URL('./flora-trains.js',import.meta.url),'utf8'),{
  document,URL,fetch:async()=>({ok:true,json:async()=>state}),clearTimeout(){},setTimeout(){throw Error('Unexpected polling');},alert(){throw Error('Unexpected alert');}
 });
 await get('trainimport').onclick();
 const html=get('reisschema-register').innerHTML;
 assert.match(html,/DEMO-&lt;script&gt;/);assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<script>|<img|href="javascript:/);assert.match(html,/Back-up/);
 assert.match(html,/niet automatisch recent/);assert.match(html,/Geen documentlink/);
 get('trainsearch').value='does-not-match';get('trainsearch').oninput();
 assert.match(get('reisschema-register').innerHTML,/0 ritten/);
});

