import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCatalogService,catalogSlot,fetchCatalogManifest,fetchInterrailDocuments} from './reishuis-catalogs.mjs';
import {initReishuis,readCatalog,writeCatalog} from './reishuis-store.mjs';
test('Amsterdam schedule has three hotel slots and seasonal 03:15 Interrail including both boundary days',()=>{
 assert.equal(catalogSlot('hotels',Date.parse('2026-10-17T06:14:00Z')),null);assert.equal(catalogSlot('hotels',Date.parse('2026-10-17T06:15:00Z')),'2026-10-17 08:15');assert.equal(catalogSlot('hotels',Date.parse('2026-10-17T10:15:00Z')),'2026-10-17 12:15');assert.equal(catalogSlot('hotels',Date.parse('2026-12-20T14:15:00Z')),'2026-12-20 15:15');
 for(const d of ['2026-12-20','2027-01-20']){assert.equal(catalogSlot('interrail',Date.parse(d+'T02:14:00Z')),null);assert.equal(catalogSlot('interrail',Date.parse(d+'T02:15:00Z')),d+' 03:15');}
 for(const d of ['2026-12-19','2027-01-21','2026-10-17'])assert.equal(catalogSlot('interrail',Date.parse(d+'T12:00:00Z')),null);
});
test('manifest and Interrail fetch use fixed read-only project and minimal fields',async()=>{
 const opts={config:{project:'il9cyh3m',dataset:'production',token:'fixture'},fetcher:async(u,o)=>{assert.equal(o.method,'GET');assert.equal(o.redirect,'error');assert.equal(u.searchParams.get('perspective'),'raw');assert.doesNotMatch(u.searchParams.get('query'),/secret|tourBooking|password|\{\s*\.\.\./);return {ok:true,json:async()=>({result:[{_id:'fixture',_updatedAt:'one',title:'Voorbeeldpas',days:4,variants:[{class:'2',ageGroup:'adult',price:123},{class:'2',ageGroup:'adult',price:'not-number'}]}]})};}};
 assert.equal((await fetchCatalogManifest('hotels',opts))[0]._id,'fixture');const passes=await fetchInterrailDocuments(['fixture'],opts);assert.equal(passes[0].variants.length,1);assert.equal(passes[0].days,4);
});
test('only changed documents reload, removed draft falls back to published, incomplete reads preserve previous snapshot',async()=>{
 const saved=new Map(),reads=[],docs=new Map([['fixture',{sourceId:'fixture',id:'fixture',updatedAt:'one',title:'Gepubliceerd'}],['drafts.fixture',{sourceId:'drafts.fixture',id:'fixture',updatedAt:'two',title:'Concept'}]]);let fail=false,now=Date.parse('2026-10-17T08:00:00Z');
 const options={clock:()=>now,read:async k=>saved.get(k),write:async(k,v)=>saved.set(k,structuredClone(v)),manifest:async()=>[...docs.values()].map(r=>({_id:r.sourceId,_updatedAt:r.updatedAt})),documents:async(k,ids)=>{reads.push(ids);return fail?[]:ids.map(id=>docs.get(id));}};
 const service=createCatalogService(options);await Promise.all([service.get('hotels'),service.get('hotels')]);assert.equal(reads.length,1);assert.equal((await service.get('hotels')).data[0].title,'Concept');await service.sync('hotels');assert.equal(reads.length,1);docs.delete('drafts.fixture');await service.sync('hotels');assert.equal((await service.get('hotels')).data[0].title,'Gepubliceerd');assert.equal(reads.length,1);
 docs.set('fixture',{...docs.get('fixture'),updatedAt:'three',title:'Gewijzigd'});await service.sync('hotels');assert.deepEqual(reads.at(-1),['fixture']);docs.set('fixture',{...docs.get('fixture'),updatedAt:'four'});fail=true;await assert.rejects(service.sync('hotels'));assert.equal((await service.get('hotels')).data[0].updatedAt,'three');
 const restarted=createCatalogService({...options,manifest:async()=>assert.fail('outside scheduled tick no source read')});assert.equal((await restarted.get('hotels')).data[0].title,'Gewijzigd');
});
test('timer ticks bootstrap once, skip already checked slots, and keep Interrail unchanged outside season',async()=>{
 let now=Date.parse('2026-10-17T05:00:00Z');const saved=new Map(),calls=[];const service=createCatalogService({clock:()=>now,read:async k=>saved.get(k),write:async(k,v)=>saved.set(k,v),manifest:async kind=>{calls.push(kind);return [];},documents:async()=>[]});await service.tick();await service.tick();assert.deepEqual(calls,['hotels','interrail']);now=Date.parse('2026-10-17T06:15:00Z');await service.tick();await service.tick();assert.deepEqual(calls,['hotels','interrail','hotels']);now=Date.parse('2026-10-17T10:15:00Z');await service.tick();assert.equal(calls.at(-1),'hotels');assert.equal(calls.filter(k=>k==='interrail').length,1);
});
test('catalog snapshots persist independently from dossiers in SQLite/Postgres-compatible store',async()=>{const sqlite=new DatabaseSync(':memory:');initReishuis({sqlite});await writeCatalog('hotels',{data:[{id:'fixture'}],checkedAt:100,version:'fixture'});initReishuis({sqlite});assert.equal((await readCatalog('hotels')).data[0].id,'fixture');assert.equal(await readCatalog('interrail'),null);sqlite.close();});


test('hotel catalog upgrades short-name projection once even when source dates are unchanged; failed upgrades retain the old catalog',async()=>{
 const legacy={formatVersion:2,entries:[{sourceId:'fixture',id:'fixture',updatedAt:'one',title:'Voorbeeld'}],data:[{id:'fixture',title:'Voorbeeld'}],version:'old',checkedAt:1};let saved=structuredClone(legacy),calls=0;
 const service=createCatalogService({read:async()=>saved,write:async(k,v)=>{saved=v;},manifest:async()=>[{_id:'fixture',_updatedAt:'one'}],documents:async()=>{calls++;return [{...legacy.entries[0],titleShort:'Kort voorbeeld'}];}});
 assert.equal((await service.get('hotels')).data[0].titleShort,'Kort voorbeeld');assert.equal(saved.formatVersion,3);await service.get('hotels');assert.equal(calls,1);
 const failed=createCatalogService({read:async()=>legacy,write:async()=>assert.fail('no incomplete snapshot'),manifest:async()=>{throw Error('fixture outage');}});assert.equal((await failed.get('hotels')).version,'old');
});
