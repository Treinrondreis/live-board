const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'',open:false,showModal(){this.open=true},close(){this.open=false}});return nodes.get(s)};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout:fn=>fn(),AbortSignal,confirm:()=>true});vm.runInContext(source,ctx);const exec=s=>vm.runInContext(s,ctx);
 exec("state={objects:[],exports:[],countries:['Nederland']};draft={kind:'book',body:{format:'A5',sections:[],values:{}}};");
 ctx.renderDraft=()=>{};ctx.run=fn=>fn();ctx.toast=()=>{};
 return {ctx,exec,node};
}
test('PDF additions preserve book format and remain editable after saving',async()=>{
 const f=fixture();f.ctx.trainScreenMaker();assert.match(f.node('#modal').innerHTML,/Datums tonen/);assert.equal(f.exec('trainScreenDraft.model.format'),'A5');
 f.ctx.api=async(path,model)=>({asset:'result',title:'Wenen',pages:1,format:'A5',trainScreen:structuredClone(model)});
 await f.ctx.trainScreenBuild({disabled:false});f.ctx.trainScreenUse();assert.equal(f.exec('draft.body.sections[0].trainScreen.mode'),'roundtrip');assert.equal(f.exec('dirty'),true);
 f.exec('draft=JSON.parse(JSON.stringify(draft))');f.ctx.editOneOff(0);assert.equal(f.exec('trainScreenDraft.model.title'),'Stedentrip Wenen');f.ctx.trainScreenInput('title','Nieuwe titel');assert.equal(f.exec('trainScreenDraft.result'),null);
});
test('ticket reads exclude vouchers, omitted and conditional sources and require review',async()=>{
 const f=fixture();f.exec("draft.body.sections=[{ticketImport:{},asset:'compose',pages:1,pageSources:[{asset:'original',page:2}]},{choice:'document',documentKind:'voucher',selected:{asset:'voucher',pages:3}},{choice:'document',documentKind:'ticket',omitted:true,selected:{asset:'omitted',pages:1}}]");f.ctx.trainScreenMaker();
 assert.deepEqual(Array.from(f.ctx.trainScreenTicketPages(),p=>({...p})),[{asset:'original',page:2}]);
 f.exec("trainScreenDraft.candidates=[{departureStation:'Utrecht C',arrivalStation:'Wien Hbf',departureTime:'19:58',arrivalTime:'09:58',departureDate:'',arrivalDate:''}]");f.ctx.trainScreenSelect(0,'0');assert.equal(f.exec('trainScreenDraft.reviewed'),false);
 let calls=0;f.ctx.api=async()=>{calls++;return {}};await assert.rejects(f.ctx.trainScreenBuild({disabled:false}),/Controleer/);assert.equal(calls,0);
});
test('late PDF cannot be added to another book and changed data invalidates preview',async()=>{
 const f=fixture();f.ctx.trainScreenMaker();let done;f.ctx.api=()=>new Promise(resolve=>done=resolve);const promise=f.ctx.trainScreenBuild({disabled:false});f.ctx.trainScreenInput('title','Changed');done({asset:'old',title:'Old',trainScreen:{}});await promise;assert.equal(f.exec('trainScreenDraft.result'),null);
 f.exec("trainScreenDraft.result={asset:'old',title:'Old',trainScreen:{}};draft={kind:'book',body:{sections:[]}};");f.ctx.trainScreenUse();assert.equal(f.exec('draft.body.sections.length'),0);
});
test('personalizing a reusable screen disconnects its PDF from library refresh',async()=>{
 const f=fixture();f.exec("state.objects=[{id:'base',kind:'block',title:'Basis',revision:1,body:{format:'A5',asset:'base-pdf',pages:1,fields:[],trainScreen:{mode:'circuit',format:'A5',title:'Uw rondreis',heading:'Treinrondreis',subtitle:'',train:'',showDates:false,legs:[{},{}],destinations:['Wenen','Praag']}}}];draft.body.sections=[snapshot(find('base'))];");
 f.ctx.trainScreenMaker(0);f.ctx.api=async(path,model)=>({asset:'personal-pdf',title:'Persoonlijk',trainScreen:structuredClone(model)});await f.ctx.trainScreenBuild({disabled:false});f.ctx.trainScreenUse();
 assert.equal(f.exec('draft.body.sections[0].asset'),'personal-pdf');assert.equal(f.exec('draft.body.sections[0].block'),undefined);
});
