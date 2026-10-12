const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),calls=[];const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'',style:{},open:false,showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},window:{addEventListener(){}},structuredClone,console,setTimeout,clearTimeout,AbortSignal,confirm:()=>true});vm.runInContext(source,ctx);
 const exec=code=>vm.runInContext(code,ctx);
 exec(`state={objects:[{id:'cover',kind:'block',revision:1,title:'Cover',body:{format:'A4',asset:'asset',pages:1,fields:[]}}],exports:[]};draft=null;`);
 const proposal=()=>({kind:'template',title:'Wenen',catalogRevisions:{cover:1},warnings:[],body:{format:'A4',values:{},sections:[{choice:'manual',title:'Voorpagina',options:[{block:'cover',title:'Cover',pages:1,asset:'asset',values:{}}],selected:{block:'cover',title:'Cover',pages:1,asset:'asset',values:{}},autoProposal:{uncertain:true,reason:'Standaard'}}]}});
 ctx.api=async(path,b)=>{calls.push({path,b:structuredClone(b)});if(path==='/api/state')return exec('state');if(path==='/api/automatic-build')return proposal();if(path==='/api/booking-data/search')return {items:[{id:'selected',number:'6563A',name:'Private Name',trip:'Wenen',values:{klantachternaam:'Private Name'}}]};if(path==='/api/booking-data/documents')return {booking:{id:b.bookingId,todos:[{title:'RITAD'}]}};throw Error(path);};
 ctx.toast=m=>ctx.message=m;ctx.run=fn=>Promise.resolve().then(fn).catch(e=>ctx.message=e.message);ctx.shell=()=>{};ctx.renderDraft=()=>{};ctx.autoFillBookingDocuments=async()=>calls.push({autofill:true});
 return {ctx,exec,node,calls,proposal};
}
test('recognition settings work separately on blocks and choice groups',()=>{
 const f=fixture();f.exec(`editor={body:{}};sharedEditor={body:{}};autoMetadataSet('block','todo','RITAD');autoMetadataSet('shared','role','cover');`);assert.equal(f.exec('editor.body.autoBuild.todo'),'RITAD');assert.equal(f.exec('sharedEditor.body.autoBuild.role'),'cover');assert.match(f.exec("autoMetadataControls(editor.body,'block')"),/Keuzegroep/);
});
test('template journey proposal is editable and applies without customer binding',async()=>{
 const f=fixture();f.exec("automaticBuilder('template');automaticInput('journey','Wenen Nightjet')");await f.exec("generateAutomaticProposal({disabled:false})");assert.match(f.node('#automaticProposal').innerHTML,/Voorstel · controleer/);f.exec("automaticChoose(0,'cover')");assert.match(f.node('#automaticProposal').innerHTML,/Keuze bevestigd/);await f.exec("applyAutomaticProposal({disabled:false})");assert.equal(f.exec('draft.kind'),'template');assert.equal(f.exec('draft.body.sanityBooking'),undefined);assert.equal(f.exec('draft.body.sections[0].choiceUserSelected'),undefined);assert(!f.calls.some(c=>c.autofill));
});
test('book requires exact selection then reads its todos and binds that customer',async()=>{
 const f=fixture();f.exec("automaticBuilder('book')");await f.exec("generateAutomaticProposal({disabled:false})");assert.match(f.ctx.message,/selecteer eerst/);f.node('#automaticBookingNumber').value='6563A';await f.exec('searchAutomaticBooking()');f.exec('selectAutomaticBooking(0)');await f.exec("generateAutomaticProposal({disabled:false})");assert.equal(f.calls.find(c=>c.path==='/api/automatic-build').b.booking.todos[0].title,'RITAD');await f.exec("applyAutomaticProposal({disabled:false})");assert.equal(f.exec('draft.body.sanityBooking.id'),'selected');assert.equal(f.exec('draft.body.values.klantachternaam'),'Private Name');assert(f.calls.some(c=>c.autofill));
});
test('template based on customer does not copy values or binding',async()=>{
 const f=fixture();f.exec("automaticBuilder('template')");f.node('#automaticBookingNumber').value='6563A';await f.exec('searchAutomaticBooking()');f.exec('selectAutomaticBooking(0)');await f.exec("generateAutomaticProposal({disabled:false})");await f.exec("applyAutomaticProposal({disabled:false})");assert(!JSON.stringify(f.exec('draft')).includes('Private Name'));assert(!f.calls.some(c=>c.autofill));
});
test('cancelled or changed inputs cannot apply stale asynchronous suggestions',async()=>{
 const f=fixture();let release,entered;const wait=new Promise(r=>release=r),start=new Promise(r=>entered=r);const old=f.ctx.api;f.ctx.api=async(path,b)=>{if(path==='/api/automatic-build'){entered();await wait;}return old(path,b);};f.exec("automaticBuilder('template');automaticInput('journey','Wenen')");const work=f.exec("generateAutomaticProposal({disabled:false})");await start;f.exec("automaticInput('journey','Parijs')");release();await work;assert.equal(f.exec('automaticWizard.proposal'),null);f.exec('cancelAutomaticBuilder()');assert.equal(f.exec('draft'),null);
});
test('changed library requires a fresh proposal; moving and omitting rows do not save',async()=>{
 const f=fixture();f.exec("automaticBuilder('template');automaticInput('journey','Wenen')");await f.exec("generateAutomaticProposal({disabled:false})");f.exec("state.objects[0].revision=2");await f.exec("applyAutomaticProposal({disabled:false})");assert.match(f.ctx.message,/bibliotheek is gewijzigd/);assert.equal(f.exec('draft'),null);f.exec("automaticWizard.proposal.body.sections.push({title:'Other'});automaticMove(1,-1);automaticRemove(0)");assert.equal(f.exec('automaticWizard.proposal.body.sections.length'),1);assert(!f.calls.some(c=>c.path==='/api/save'));
});
test('automatic template suggestions re-evaluate for the customer and retain an uncertain proposal',async()=>{
 const f=fixture();const old=f.ctx.api;f.ctx.api=async(path,b)=>path==='/api/automatic-choices'?{choices:[{index:0,block:'b',autoProposal:{uncertain:true,reason:'Meerdere keuzes passen even goed'}}]}:old(path,b);
 f.exec(`draft={kind:'book',body:{sanityBooking:{id:'selected'},sections:[{choice:'manual',options:[{block:'a',title:'A',todoMatch:'RITAD'},{block:'b',title:'B',todoMatch:'RITAD'}],selected:{block:'a'},autoProposal:{uncertain:true,reason:'Tie'}}]}}`);await f.exec('applyBookingChoices()');assert.equal(f.exec('draft.body.sections[0].selected.block'),'b');assert.match(f.exec('autoProposalNotice(draft.body.sections[0])'),/Meerdere keuzes passen/);
});
