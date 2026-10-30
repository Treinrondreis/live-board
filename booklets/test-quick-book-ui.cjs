const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(options={}){
 const nodes=new Map(),calls=[],exports=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',open:false,scrollIntoView(){},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id);};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,confirm:()=>true});
 vm.runInContext(source,ctx);const exec=s=>vm.runInContext(s,ctx);
 exec(`state={objects:[],exports:[]};draft={kind:'book',title:'Voorbeeldreis',body:{format:'A4',outputMode:'${options.screen?'screen':'print'}',values:{},sanityBooking:{id:'fictional-booking',number:'1234',name:'Voorbeeld'},sections:[{choice:'document',title:'Tickets',documentKind:'nsTickets',selected:null}]}};dirty=true;view='books'`);
 ctx.run=fn=>fn();ctx.renderDraft=()=>calls.push({render:true});ctx.toast=()=>{};
 ctx.batchFileUrl=id=>'/files/export/'+id;
 ctx.applyBookingChoices=async()=>{calls.push({choices:true});};
 ctx.autoFillBookingDocuments=async()=>{calls.push({imports:true});exec(`draft.body.sections[0].selected={asset:'fictional-ticket',pages:1,fields:[],title:'Ticket'};dirty=true`);if(options.importHook)await options.importHook(ctx,exec);};
 ctx.checkBookingDocumentSources=async()=>{calls.push({sources:true});if(options.stale)throw Error('Bron gewijzigd. Haal opnieuw op.');};
 ctx.refresh=async()=>{ctx.data={objects:[],exports:structuredClone(exports)};exec('state=data');};
 let saves=0;
 ctx.persistDraft=async()=>{calls.push({save:true});saves++;if(options.conflict)throw Error('Een collega heeft dit boekje gewijzigd.');exec(`draft.id='${'a'.repeat(32)}';draft.revision=${saves};dirty=false`);};
 ctx.checkExport=async(body,fill)=>{calls.push({check:true,fill});if(options.checkHook)await options.checkHook(ctx,exec);return {pages:4,missing:options.missing?['Route']:[],errors:options.error?[{title:'Tekst',message:'Past niet'}]:[],warnings:['Informatieve melding'],fillRequested:fill,needed:options.noFiller?1:0,canFill:!options.noFiller,libraryStamp:'fictional-library'};};
 ctx.api=async(path,body)=>{
  calls.push({path,body:structuredClone(body)});
  if(path==='/api/google/prepare')return {errors:[{title:'Route',message:'Bron onbereikbaar'}]};
  if(path==='/api/export'){
   if(options.failExport)throw Error('Antwoord onderbroken');
   const record={id:'b'.repeat(32),book_id:body.id,bookRevision:body.revision,report:{pages:4}};exports.push(record);
   if(options.lostResponse)throw Error('Antwoord onderbroken');return record;
  }
  throw Error('Unexpected '+path);
 };
 return {ctx,exec,calls,node,exports,start:()=>ctx.makeQuickBook(),feedback:()=>exec('quickBookFeedback'),pdfs:()=>calls.filter(c=>c.path==='/api/export')};
}
test('complete book imports, checks, saves and generates once without an extra confirmation',async()=>{
 const f=fixture();await f.start();assert.equal(f.pdfs().length,1);const request=f.pdfs()[0].body;assert.equal(request.skipChoices,false);assert.equal(request.fill,true);assert.equal(request.allowUneven,false);assert.equal(request.libraryStamp,'fictional-library');assert.equal(f.feedback().exportId,'b'.repeat(32));assert(!f.node('#modal').open);assert.equal(f.exec('quickBookRun'),null);assert(f.calls.findIndex(c=>c.sources)<f.calls.findIndex(c=>c.check));assert(f.calls.findIndex(c=>c.save)<f.calls.findIndex(c=>c.path==='/api/export'));
});
test('missing documents, fields, choices, uncertain proposals and unavailable filler return to the saved editor',async()=>{
 for(const options of [{missing:true},{error:true},{noFiller:true},{importHook:async(ctx,exec)=>exec('draft.body.sections[0].selected=null')},{importHook:async(ctx,exec)=>exec('draft.body.sections[0].autoProposal={confirmed:false}')},{importHook:async(ctx,exec)=>exec('draft.body.sections[0].selected.reviewRequired=true')}]){
  const f=fixture(options);await f.start();assert.equal(f.pdfs().length,0);assert(f.calls.some(c=>c.save));assert(f.calls.some(c=>c.render));assert(f.feedback().messages.length);assert.equal(f.exec('draft.body.sanityBooking.id'),'fictional-booking');
 }
});
test('informative notices do not block, screen output never uses print filling',async()=>{
 const f=fixture({screen:true});await f.start();assert.equal(f.pdfs().length,1);assert.equal(f.pdfs()[0].body.fill,false);assert.equal(f.pdfs()[0].body.allowUneven,true);
});
test('stale source or unavailable Google document preserves imports, never silently uses cached content',async()=>{
 for(const options of [{stale:true},{importHook:async(ctx,exec)=>exec('draft.body.sections[0].selected.googleDoc={id:"fictional"}') }]){
  const f=fixture(options);await f.start();assert(!f.pdfs().length);assert(f.calls.some(c=>c.save));assert.equal(f.exec('draft.body.sections[0].selected.asset'),'fictional-ticket');assert(f.calls.every(c=>!c.body?.allowCached));
 }
});
test('stop or changed booking while awaiting a source cannot create a PDF or save to another booking',async()=>{
 let release;const f=fixture({importHook:()=>new Promise(r=>release=r)}),work=f.start();await new Promise(r=>setImmediate(r));f.ctx.stopQuickBook();release();await work;assert(!f.pdfs().length);assert(f.calls.some(c=>c.save));assert.match(f.feedback().messages[0],/gestopt/);
 let done;const changed=fixture({importHook:()=>new Promise(r=>done=r)}),pending=changed.start();await new Promise(r=>setImmediate(r));changed.exec('draft.body.sanityBooking={id:"other-booking"}');done();await pending;assert(!changed.pdfs().length);assert(!changed.calls.some(c=>c.save));assert.equal(changed.feedback(),null);
});
test('double activation and a failed or lost export response never issue a second export',async()=>{
 let release;const f=fixture({importHook:()=>new Promise(r=>release=r)}),work=f.start();await new Promise(r=>setImmediate(r));await f.start();release();await work;assert.equal(f.pdfs().length,1);
 const lost=fixture({lostResponse:true});await lost.start();assert.equal(lost.pdfs().length,1);assert.equal(lost.feedback().exportId,'b'.repeat(32));
 const failed=fixture({failExport:true});await failed.start();assert.equal(failed.pdfs().length,1);assert.equal(failed.feedback().exportId,undefined);assert.match(failed.feedback().messages.join(' '),/Controleer Gemaakte PDF/);
});
test('save conflict blocks export without an automatic second save; result text is escaped',async()=>{
 const f=fixture({conflict:true});await f.start();assert.equal(f.calls.filter(c=>c.save).length,1);assert(!f.pdfs().length);assert.equal(f.exec('dirty'),true);
 f.exec('quickBookFeedback.messages=["<img src=x onerror=bad>"]');assert.match(f.ctx.quickBookResult(),/&lt;img/);
});
test('template use marks only the new book for the shortcut; normal rebinding keeps the old route',async()=>{
 const f=fixture();f.ctx.bookingSearchForm=()=>{};f.ctx.renderDraft=()=>{};
 f.exec(`state.objects=[{id:'template',kind:'template',title:'Voorbeeld',body:{format:'A4',values:{},sections:[]}}]`);f.ctx.startBookFromTemplate(f.exec('state.objects[0]'));assert.equal(f.exec('quickBookIntent===draft'),true);
 f.ctx.closeModal();assert.equal(f.exec('quickBookIntent'),null);
 f.ctx.autoFillBookingDocuments=async()=>f.calls.push({imports:true});
 f.exec(`draft.body.sanityBooking=null;bookingLookup={book:draft,items:[{id:'fictional-booking',number:'1234',name:'Voorbeeld',values:{}}]}`);await f.ctx.bindSanityBooking(0);assert(!f.pdfs().length);assert(f.calls.some(c=>c.imports));
});
