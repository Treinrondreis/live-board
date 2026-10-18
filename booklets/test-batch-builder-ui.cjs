const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const main=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
const batch=fs.readFileSync(__dirname+'/batch-builder.js','utf8');
function fixture(options={}){
 const nodes=new Map(),calls=[],objects=new Map(),exports=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,innerHTML:'',open:false,disabled:false,focus(){},scrollIntoView(){},classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id);};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[],hidden:false},window:{addEventListener(){}},location:{pathname:'/seinhuis/boekjesmaker/'},crypto:require('node:crypto').webcrypto,structuredClone,console,setTimeout,clearTimeout,setInterval(){},confirm:()=>true});vm.runInContext(batch,ctx);vm.runInContext(main,ctx);const exec=s=>vm.runInContext(s,ctx);
 const template={id:'a'.repeat(32),kind:'template',title:'Voorbeeldsjabloon',revision:1,body:{format:'A4',outputMode:'screen',values:{klantvoornaam:'STALE_TEMPLATE_VALUE'},sections:[{oneOff:true,asset:'generic',title:'Vaste pagina',pages:1,fields:[],values:{name:'STALE_OVERLAY'}},{choice:'document',documentKind:'voucher',title:'Hotel',selected:{asset:'OLD_CUSTOMER_PDF'},options:[]}],status:'Concept'}};
 objects.set(template.id,structuredClone(template));const bookings=[{id:'booking-one',number:'1234',name:'Voorbeeld A',values:{klantvoornaam:'Voorbeeld A'}},{id:'booking-two',number:'2345',name:'Voorbeeld B',values:{klantvoornaam:'Voorbeeld B'}}];
 const refresh=async()=>{ctx.data={objects:[...objects.values()].map(o=>structuredClone(o)),exports:structuredClone(exports),countries:[]};exec('state=data');};ctx.refresh=refresh;ctx.run=fn=>fn();ctx.toast=t=>calls.push({toast:t});ctx.goToBookIssue=()=>{};
 let saves=0,exportCalls=0,inspections=0;
 ctx.api=async(path,body)=>{calls.push({path,body:structuredClone(body)});const route=path.replace('/seinhuis/boekjesmaker','');
  if(route==='/api/save'){saves++;if(options.failSave===saves)throw Error('Opslaan mislukt');const old=objects.get(body.id);if(old&&old.revision!==body.revision)throw Error('Een collega heeft dit boekje gewijzigd.');const row={...structuredClone(body),revision:(old?.revision||0)+1};objects.set(row.id,row);return {id:row.id,revision:row.revision};}
  if(route==='/api/export'){exportCalls++;if(options.failExport===body.id)throw Error('PDF mislukt');const item={id:require('node:crypto').randomUUID().replaceAll('-',''),book_id:body.id,bookRevision:body.revision,report:{pages:4}};exports.unshift(item);if(options.timeoutAfterExport)throw Error('Antwoord onderbroken');return {id:item.id,report:item.report,storage:'drive'};}
  if(route==='/api/booking-data/search')return {items:options.lookup?options.lookup(body.number):bookings.filter(b=>b.number===body.number)};
  if(route==='/api/google/prepare')return {errors:[{title:'Route',message:'Google-bron niet bereikbaar'}]};
  throw Error('Unexpected '+route);
 };
 ctx.applyBookingChoices=async()=>{};
 ctx.autoFillBookingDocuments=async()=>{const d=exec('draft');calls.push({import:d.body.sanityBooking.id});if(options.failImport===d.body.sanityBooking.id)throw Error('Ticket ontbreekt');d.body.sections[1].selected??={asset:'pdf-for-'+d.body.sanityBooking.id,title:'Hotel',pages:1,fields:[],warnings:options.warning?['Controleer de datum']:[]};if(options.stopAfterFirst)exec('batchSession.stopRequested=true');};
 ctx.checkBookingDocumentSources=async()=>{};
 ctx.checkExport=async(body,fill)=>{inspections++;calls.push({check:body.sanityBooking.id,fill});return {pages:2,checkedPages:2,needed:0,missing:[],fillers:[],canFill:true,errors:options.failCheck===body.sanityBooking.id?[{title:'Tekst',message:'Past niet'}]:[],libraryStamp:'library-'+inspections,warnings:[],fillerWarnings:[]};};
 ctx.bookingList=bookings;exec(`user={name:'Voorbeeld'};batchSession={id:'${'f'.repeat(32)}',templateId:'${template.id}',templateName:'Voorbeeldsjabloon',fill:true,phase:'lookup',running:false,rows:bookingList.map(b=>({number:b.number,booking:structuredClone(b),status:'queued',messages:[]}))};view='batch'`);
 return {ctx,exec,node,calls,objects,exports,bookings,template,refresh,rows:()=>exec('batchSession.rows'),start:async()=>{await refresh();await ctx.runBatchQueue('prepare');},exportCalls:()=>exportCalls};
}
test('one to five booking numbers are normalized, duplicates collapse and excess or invalid input is rejected',()=>{
 const f=fixture();assert.deepEqual(Array.from(f.ctx.parseBatchNumbers('1234A, 2345\n1234')),['1234','2345']);for(const text of ['', 'abc','1234 2345 3456 4567 5678 6789','1234<script>'])assert.throws(()=>f.ctx.parseBatchNumbers(text));
});
test('preparation saves separate books, resets inherited customer values and checks sequentially',async()=>{
 const f=fixture();await f.start();const rows=f.rows();assert(rows.every(r=>r.status==='ready'));assert.notEqual(rows[0].bookId,rows[1].bookId);
 const books=rows.map(r=>f.objects.get(r.bookId));for(let i=0;i<2;i++){assert.equal(books[i].body.sanityBooking.id,f.bookings[i].id);assert.equal(books[i].body.values.klantvoornaam,f.bookings[i].name);assert.equal(books[i].body.sections[1].selected.asset,'pdf-for-'+f.bookings[i].id);assert(!JSON.stringify(books[i]).includes('STALE_'));assert(!JSON.stringify(books[i]).includes('OLD_CUSTOMER_PDF'));}
 assert.equal(f.template.body.sections[1].selected.asset,'OLD_CUSTOMER_PDF');assert.deepEqual(f.calls.filter(c=>c.import).map(c=>c.import),['booking-one','booking-two']);assert.equal(f.exports.length,0);
});
test('generation rechecks each approved book, emits separate exports and replay never duplicates them',async()=>{
 const f=fixture();await f.start();await f.ctx.runBatchQueue('generate');assert(f.rows().every(r=>r.status==='done'));assert.equal(f.exports.length,2);assert.notEqual(f.exports[0].book_id,f.exports[1].book_id);assert.notEqual(f.exports[0].id,f.exports[1].id);
 await f.ctx.runBatchQueue('generate');assert.equal(f.exports.length,2);assert.equal(f.exportCalls(),2);assert(f.calls.filter(c=>c.path?.includes('/api/export')).every(c=>c.body.skipChoices===false));
});
test('one failed booking does not block others and no PDF is generated for a failed or deselected row',async()=>{
 const f=fixture({failCheck:'booking-one'});await f.start();assert.equal(f.rows()[0].status,'review');assert.equal(f.rows()[1].status,'ready');await f.ctx.runBatchQueue('generate');assert.equal(f.exports.length,1);assert.equal(f.exports[0].book_id,f.rows()[1].bookId);
 const deselected=fixture();await deselected.start();deselected.rows()[0].selected=false;await deselected.ctx.runBatchQueue('generate');assert.equal(deselected.exports.length,1);
});
test('saved drafts allow stopping and group recovery without duplicating books or replacing customer selection',async()=>{
 const f=fixture({stopAfterFirst:true});await f.start();assert.equal([...f.objects.values()].filter(o=>o.kind==='book').length,2);assert.equal(f.calls.filter(c=>c.import).length,1);
 const id=f.exec('batchSession.id');f.exec('batchSession=null');await f.ctx.openBatchGroup(id);assert.equal(f.rows().length,2);assert(f.rows().every(r=>r.status==='queued'));assert.equal(new Set(f.rows().map(r=>r.bookId)).size,2);
});
test('ambiguous booking matches require a choice and duplicate customers are rejected before saves',async()=>{
 const f=fixture({lookup:()=>[{id:'first',number:'1234',name:'Voorbeeld A'},{id:'second',number:'1234',name:'Voorbeeld B'}]});f.node('#batchTemplate').value=f.template.id;f.node('#batchNumbers').value='1234';f.node('#batchFill').checked=true;
 await f.ctx.lookupBatchBookings();assert.equal(f.rows()[0].booking,null);assert.match(f.node('#main').innerHTML,/Kies de juiste boeking/);assert.equal([...f.objects.values()].filter(o=>o.kind==='book').length,0);
 f.ctx.selectBatchBooking(0,'second');assert.equal(f.rows()[0].booking.id,'second');
 const duplicate=fixture();duplicate.rows()[1].booking=duplicate.rows()[0].booking;await assert.rejects(duplicate.ctx.runBatchQueue('prepare'),/andere, eenduidige boeking/);assert(!duplicate.calls.some(c=>c.path?.includes('/api/save')));
});
test('a colleague edit after review blocks export and cannot be overwritten',async()=>{
 const f=fixture();await f.start();const book=f.objects.get(f.rows()[0].bookId);book.revision++;book.body.values.klantvoornaam='Gewijzigd door collega';await f.ctx.runBatchQueue('generate');assert.equal(f.rows()[0].status,'error');assert.match(f.rows()[0].messages[0],/sinds de controle gewijzigd/);assert.equal(f.objects.get(book.id).body.values.klantvoornaam,'Gewijzigd door collega');assert.equal(f.exports.length,1);
});
test('a committed export with a lost response is recovered and not created twice',async()=>{
 const f=fixture({timeoutAfterExport:true});await f.start();await f.ctx.runBatchQueue('generate');assert(f.rows().every(r=>r.status==='done'));await f.ctx.runBatchQueue('generate');assert.equal(f.exports.length,2);
});
test('uncertain choices, changed warnings and unavailable Google sources never silently pass',async()=>{
 const f=fixture();await f.start();const old=f.ctx.checkExport;f.ctx.checkExport=async(...args)=>({...await old(...args),warnings:['Nieuw aandachtspunt']});await f.ctx.runBatchQueue('generate');assert(f.rows().every(r=>r.status==='review'));assert.equal(f.exports.length,0);
 const google=fixture();google.objects.get(google.template.id).body.sections[0].googleDoc={url:'https://docs.google.com/document/d/example/edit'};await google.start();assert(google.rows().every(r=>r.status==='error'));assert(google.calls.some(c=>c.path?.endsWith('/api/google/prepare')));assert(!google.calls.some(c=>c.body?.allowCached));
 const uncertain=fixture();uncertain.objects.get(uncertain.template.id).body.sections[0].autoProposal={confirmed:false};await uncertain.start();assert(uncertain.rows().every(r=>r.status==='review'));
});
test('batch endpoints and PDF links use the authenticated gateway; warnings and labels are escaped',async()=>{
 const f=fixture({warning:true});await f.start();f.rows()[0].booking.name='<img src=x onerror=bad>';f.ctx.renderBatch();assert.match(f.node('#main').innerHTML,/&lt;img/);assert(!f.node('#main').innerHTML.includes('<img src=x'));assert(f.calls.filter(c=>c.path?.endsWith('/api/save')).every(c=>c.path.startsWith('/seinhuis/boekjesmaker/')));assert.equal(f.ctx.batchFileUrl('a'.repeat(32)),'/seinhuis/boekjesmaker/files/export/'+'a'.repeat(32));
});

test('print filling is checked, screen PDFs never get filler and failed saves retain stable identities on retry',async()=>{
 const screen=fixture();await screen.start();assert(screen.calls.filter(c=>c.check).every(c=>c.fill===false));
 const print=fixture();print.objects.get(print.template.id).body.outputMode='print';print.ctx.checkExport=async()=>({pages:3,needed:1,canFill:false,missing:[],errors:[],warnings:[],fillers:[],libraryStamp:'print'});await print.start();assert(print.rows().every(r=>r.status==='review'));assert.match(print.rows()[0].messages.join(' '),/onvoldoende vulpagina/);
 const failed=fixture({failSave:1});await failed.start();const id=failed.rows()[0].bookId;await failed.ctx.runBatchQueue('prepare');assert.equal(failed.rows()[0].bookId,id);assert.equal([...failed.objects.values()].filter(o=>o.kind==='book').length,2);
});

test('manual corrections survive returning to the group and a double start cannot create extra books',async()=>{
 const f=fixture();await f.refresh();await Promise.all([f.ctx.runBatchQueue('prepare'),f.ctx.runBatchQueue('prepare')]);assert.equal([...f.objects.values()].filter(o=>o.kind==='book').length,2);
 await f.ctx.openBatchBook(0);f.exec("draft.body.sections[1].selected.asset='manually-chosen';draft.body.values.extra='Eigen tekst';dirty=true");await f.ctx.returnToBookBatch();await f.ctx.runBatchQueue('prepare');const book=f.objects.get(f.rows()[0].bookId);assert.equal(book.body.sections[1].selected.asset,'manually-chosen');assert.equal(book.body.values.extra,'Eigen tekst');
});

test('editing a generated book queues a new PDF while keeping the earlier PDF and other finished bookings',async()=>{
 const f=fixture();await f.start();await f.ctx.runBatchQueue('generate');const group=f.exec('batchSession.id'),book=f.objects.get(f.rows()[0].bookId),old=f.rows()[0].exportId;book.revision++;book.body.values.extra='Gewijzigde reis';await f.ctx.openBatchGroup(group);assert.equal(f.rows()[0].status,'queued');assert.equal(f.rows()[1].status,'done');await f.ctx.runBatchQueue('prepare');await f.ctx.runBatchQueue('generate');assert.equal(f.exports.length,3);assert(f.exports.some(e=>e.id===old));assert.notEqual(f.rows()[0].exportId,old);
});
