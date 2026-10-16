const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),cards=[],calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id:id.slice(1),value:'',innerHTML:'',hidden:false,open:false,style:{},showModal(){this.open=true},close(){this.open=false},focus(){ctx.document.activeElement=this},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b}});return nodes.get(id);};
 const ctx=vm.createContext({document:{hidden:false,querySelector:node,querySelectorAll:()=>cards,addEventListener(){}},window:{addEventListener(){}},crypto:require('node:crypto').webcrypto,structuredClone,console,setTimeout,clearTimeout,setInterval(){}});
 vm.runInContext(source,ctx);const exec=t=>vm.runInContext(t,ctx);
 ctx.api=async(path,b)=>{calls.push({path,b});return {objects:[],exports:[]}};ctx.run=fn=>Promise.resolve().then(fn);ctx.toast=()=>{};
 return {ctx,exec,node,cards,calls};
}
test('newest book per exact booking is prominent; older books and trash remain accessible',()=>{
 const f=fixture();f.exec(`state={objects:[{id:'old',kind:'book',title:'Old',createdAt:'2026-10-01',body:{sections:[],sanityBooking:{id:'same'}}},{id:'new',kind:'book',title:'New',createdAt:'2026-10-02',body:{sections:[],sanityBooking:{id:'same'}}},{id:'other',kind:'book',title:'Other',createdAt:'2026-09-20',body:{sections:[],sanityBooking:{id:'different'}}}],exports:[]};renderBookings($('#main'))`);
 assert.deepEqual(Array.from(f.exec('latestBookIds()')).sort(),['new','other']);assert.match(f.node('#main').innerHTML,/Oudere boekjes/);assert.match(f.node('#main').innerHTML,/Boekje verwijderen/);assert.match(f.node('#main').innerHTML,/Prullenbak met verwijderde/);
 assert(f.node('#main').innerHTML.indexOf('data-book-id="new"')<f.node('#main').innerHTML.indexOf('data-book-id="old"'));
 for(const id of ['old','new'])f.cards.push({dataset:{bookId:id,older:String(id==='old')},hidden:false});f.exec('filterBookings()');assert.equal(f.cards[0].hidden,true);f.exec('bookingOlder=true;filterBookings()');assert.equal(f.cards[0].hidden,false);
});
test('colleague refresh never replaces an open draft or loses the search cursor',async()=>{
 const f=fixture();let rendered=0;f.ctx.render=()=>rendered++;
 f.ctx.api=async()=>({objects:[{id:'new',kind:'book'}],exports:[]});const input=f.node('#bookingSearch');input.selectionStart=2;input.selectionEnd=3;f.ctx.document.activeElement=input;
 await f.exec('refreshOverview()');assert.equal(rendered,1);assert.equal(f.ctx.document.activeElement,input);assert.equal(input.selectionStart,2);
 f.exec(`draft={kind:'book',body:{values:{demo:'unsaved'}}};dirty=true`);await f.exec('refreshOverview()');assert.equal(rendered,1);assert.equal(f.exec('draft.body.values.demo'),'unsaved');assert.equal(f.exec('dirty'),true);
});
test('older refresh responses cannot hide a newly saved colleague book',async()=>{
 const f=fixture();let release;f.ctx.api=()=>new Promise(r=>release=r);const old=f.exec('refresh()');
 f.ctx.api=async()=>({objects:[{id:'new'}],exports:[]});await f.exec('refresh()');release({objects:[],exports:[]});await old;assert.equal(f.exec('state.objects[0].id'),'new');
});
test('closing preflight cancels its job and ignores a late result; retry gets a new identity',async()=>{
 const f=fixture();let release;f.exec(`draft={kind:'book',body:{sections:[]}}`);
 f.ctx.api=async(path,b)=>{f.calls.push({path,b});if(path==='/api/export-plan')return new Promise(r=>release=r);return {ok:true}};
 const first=f.exec('checkExport(draft.body,false)');const firstId=f.calls[0].b.checkId;f.exec('closeModal()');release({pages:3});assert.equal(await first,null);assert.equal(f.calls[1].path,'/api/export-cancel');assert.equal(f.calls[1].b.checkId,firstId);
 f.ctx.api=async(path,b)=>{f.calls.push({path,b});return {pages:3}};assert.equal((await f.exec('checkExport(draft.body,false)')).pages,3);assert.notEqual(f.calls.at(-1).b.checkId,firstId);
});
test('a failed PDF check leaves generation enabled and can be run again on the same concept',async()=>{
 const f=fixture();f.exec(`draft={kind:'book',title:'Synthetic',body:{sections:[],values:{},outputMode:'screen'}}`);f.ctx.prepareGoogleBook=async()=>true;f.ctx.refreshDraftBlocks=()=>{};let failed=true;
 f.ctx.api=async path=>{if(path==='/api/state')return {objects:[],exports:[]};if(path==='/api/export-plan'){if(failed)throw Error('Processing');return {pages:3,needed:0,missing:[],fillers:[],errors:[]}}return {ok:true}};
 f.ctx.button={disabled:false};await assert.rejects(f.exec('exportBook(button)'),/Processing/);assert.equal(f.ctx.button.disabled,false);failed=false;await f.exec('exportBook(button)');assert.equal(f.ctx.button.disabled,false);assert.match(f.node('#modal').innerHTML,/PDF maken/);
});
