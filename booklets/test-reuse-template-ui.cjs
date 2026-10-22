const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',open:false,checked:false});return nodes.get(id);};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,setTimeout,clearTimeout,confirm:()=>true});
 vm.runInContext(source,ctx);const exec=s=>vm.runInContext(s,ctx),calls=[];
 for(const name of ['renderDraft','stopBookingAutoLoad','cancelExportCheck','bookingSearchForm','closeModal'])ctx[name]=()=>calls.push(name);
 ctx.run=fn=>fn();ctx.refresh=async()=>{};ctx.toast=message=>calls.push(message);ctx.navigate=view=>calls.push(view);
 exec(`state={objects:[{id:'template',kind:'template',title:'Voorbeeldreis',revision:2,body:{format:'A4',sections:[{title:'Vaste pagina',asset:'generic',pages:1,fields:[],values:{}},{choice:'document',documentKind:'voucher',title:'Vouchers',selected:null}],values:{},duplex:true}}],exports:[]};draft={id:'previous-book',revision:8,kind:'book',title:'Vorige klant',body:{templateId:'template',templateName:'Oude sjabloonnaam',sanityBooking:{id:'previous-booking'},values:{klantvoornaam:'Fictieve vorige klant'},sections:[{asset:'private-source',pages:1,title:'Persoonlijk document'}]}};dirty=false`);
 return {ctx,exec,node,calls};
}
test('reuse starts a separate booking from the latest template, without previous customer documents',async()=>{
 const f=fixture(),previous=f.exec('structuredClone(draft)');await f.ctx.reuseBookTemplate();
 assert.equal(f.exec('draft.kind'),'book');assert.equal(f.exec('draft.id'),undefined);assert.equal(f.exec('draft.revision'),undefined);assert.equal(f.exec('draft.title'),'');
 assert.equal(f.exec('draft.body.templateId'),'template');assert.equal(f.exec('draft.body.templateName'),'Voorbeeldreis');assert.equal(f.exec('draft.body.status'),'Concept');assert.equal(f.exec('draft.body.sanityBooking'),undefined);
 assert.deepEqual(Object.keys(f.exec('draft.body.values')),[]);assert.equal(f.exec('draft.body.sections.length'),2);assert.equal(f.exec('draft.body.sections[1].selected'),null);
 assert(!JSON.stringify(f.exec('draft')).includes('private-source'));assert(!JSON.stringify(f.exec('draft')).includes('Fictieve vorige klant'));assert.equal(previous.id,'previous-book');assert(f.calls.includes('bookingSearchForm'));assert.equal(f.exec('dirty'),true);
 assert.equal(f.exec("find('template').body.sections[1].selected"),null);
});
test('new bookings record template identity and clear any stale Google preparation',async()=>{
 const f=fixture();f.exec("draft=null;find('template').body._googlePreparation='old-check'");await f.ctx.fromTemplate('template');
 assert.equal(f.exec('draft.body.templateId'),'template');assert.equal(f.exec('draft.body._googlePreparation'),undefined);
});
test('legacy books may reuse a unique exact name, but duplicate names require choosing',async()=>{
 const f=fixture();f.exec("delete draft.body.templateId;draft.body.templateName='Voorbeeldreis'");await f.ctx.reuseBookTemplate();assert.equal(f.exec('draft.body.templateId'),'template');
 const duplicate=fixture();duplicate.exec("delete draft.body.templateId;draft.body.templateName='Voorbeeldreis';state.objects.push({...structuredClone(state.objects[0]),id:'other'})");await duplicate.ctx.reuseBookTemplate();assert(duplicate.calls.includes('templates'));assert(!duplicate.calls.includes('bookingSearchForm'));
});
test('an archived, deleted or missing original is never replaced with a same-named template',async()=>{
 for(const flag of ['archived','deletedAt','missing']){
  const f=fixture();f.exec(`find('template').body.${flag}=true;state.objects.push({...structuredClone(state.objects[0]),id:'replacement',body:{sections:[]}})`);if(flag==='missing')f.exec("state.objects=state.objects.filter(o=>o.id!=='template')");
  await f.ctx.reuseBookTemplate();assert(f.calls.includes('templates'));assert(!f.calls.includes('bookingSearchForm'));
 }
});
test('unsaved changes may cancel reuse; a late refresh never replaces a different open book',async()=>{
 const f=fixture();f.exec('dirty=true');f.ctx.confirm=()=>false;await f.ctx.reuseBookTemplate();assert.equal(f.exec('draft.id'),'previous-book');
 const late=fixture();let release;late.ctx.refresh=()=>new Promise(r=>release=r);const task=late.ctx.reuseBookTemplate();late.exec("draft={kind:'book',id:'different',body:{sections:[]}}");release();await task;assert.equal(late.exec('draft.id'),'different');
});
test('the saved PDF result offers reuse and a direct return to templates',async()=>{
 const f=fixture();f.exec('exportPlan={missing:[],libraryStamp:"checked"}');f.ctx.checkExport=async()=>({errors:[],libraryStamp:'checked'});f.ctx.persistDraft=async()=>{};
 let completed;f.ctx.run=fn=>completed=fn();f.ctx.api=async()=>({id:'export',url:'/files/export/export',report:{pages:4,blanks:0,warnings:[]}});f.ctx.finishExport({disabled:false});await completed;
 assert.match(f.node('#exportResult').innerHTML,/Nieuwe boeking met dit sjabloon/);assert.match(f.node('#exportResult').innerHTML,/Terug naar sjablonen/);
});
