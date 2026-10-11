const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(options={}){
 const nodes=new Map(),calls=[],composed=[];
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:false,checked:true,showModal(){this.open=true},close(){this.open=false}});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout,confirm:()=>true,AbortSignal});
 vm.runInContext(source,ctx);
 ctx.api=async(path,b)=>{calls.push({path,b:structuredClone(b)});if(options.api){const r=await options.api(path,b);if(r!==undefined)return r;}
  if(path==='/api/booking-data/documents')return {items:options.items||[{id:'letter',kind:'letter'},{id:'voucher1',kind:'voucher',approved:true},{id:'voucher2',kind:'voucher',approved:true}]};
  if(path==='/api/booking-data/document')return {bookingId:b.bookingId,documentId:b.documentId,kind:b.documentId.startsWith('voucher')?'voucher':'letter',approved:true,digest:'current'};
  if(path==='/api/booking-documents/render')return {asset:b.document.documentId,pages:2,format:b.format,bookingDocument:{...b.document,layout:b.document.kind==='letter'?(b.letterLayout==='columns'?'treinrondreis-letter-columns-1':'treinrondreis-letter-1'):'treinrondreis-voucher-1'}};
  if(path==='/api/booking-documents/drive-search')return {items:options.driveItems||[{id:'drive',recommended:true}]};
  if(path==='/api/booking-documents/drive-load')return {asset:'drive',pages:2,driveDocument:{id:b.id}};
  if(path==='/api/mail-tickets/search')return options.mail||{references:['ABCDEF','GHIJKL'],messages:[{id:'new',reference:'ABCDEF',latest:true,tickets:[{id:'a',title:'A'},{id:'b',title:'B'}]},{id:'old',reference:'ABCDEF',latest:false,tickets:[{id:'old',title:'OLD'}]},{id:'other',reference:'GHIJKL',latest:true,tickets:[{id:'c',title:'C'}]},{id:'foreign',reference:'ZZZZZZ',latest:true,tickets:[{id:'foreign',title:'FOREIGN'}]}]};
  if(path.startsWith('/api/upload'))return {id:'uploaded-'+b,pages:1};
  if(path==='/api/tickets/inspect')return {pages:Array.from({length:b.asset.startsWith('uploaded-')?1:2},(_,page)=>({asset:b.asset,page,travelDate:b.asset==='uploaded-c'?'2026-10-16':'2026-10-10',dateSource:'pdf',dateNeedsReview:false}))};
  if(path==='/api/tickets/compose'){composed.push(structuredClone(b));return {asset:'composed-'+composed.length,pages:b.pages.length,format:b.format};}
  throw Error('Unexpected API '+path);
 };
 ctx.fetch=async(path,request)=>{const ticket=JSON.parse(request.body).ticket;calls.push({path,ticket});if(ticket===options.failTicket)throw Error('Ticket unavailable');return {ok:true,arrayBuffer:async()=>ticket};};
 ctx.run=fn=>{ctx.lastRun=Promise.resolve().then(fn);return ctx.lastRun;};
 vm.runInContext(`state={objects:[],exports:[]};draft={kind:'book',title:'',body:{format:'A4',values:{},sections:['letter','schedule','nsTickets','voucher'].map(k=>({choice:'document',documentKind:k,title:documentNames[k],options:[],selected:null})),sanityBooking:{id:'exact-customer',number:'1234A',name:'Test Reiziger',sameNumberBookings:1}}}`,ctx);
 return {ctx,node,calls,composed,exec:code=>vm.runInContext(code,ctx),slots:()=>vm.runInContext('draft.body.sections',ctx)};
}
test('choosing a booking fills all fixed places, newest NS mail per exact reference and all approved vouchers',async()=>{
 const f=fixture();f.exec(`delete draft.body.sanityBooking;bookingLookup={book:draft,items:[{id:'exact-customer',number:'1234A',name:'Test Reiziger',sameNumberBookings:1,values:{klantvoornaam:'Test'}}]}`);
 await f.exec('bindSanityBooking(0)');assert(f.slots().every(s=>s.selected));assert.equal(f.exec('draft.body.values.klantvoornaam'),'Test');
 assert.deepEqual(Array.from(f.slots(),s=>s.documentKind),['letter','schedule','nsTickets','voucher']);
 assert.deepEqual(f.calls.filter(c=>c.ticket).map(c=>c.ticket),['a','b','c']);assert.equal(f.slots()[2].selected.pages,3);
 assert.deepEqual(Array.from(f.slots()[3].selected.bookingDocuments,d=>d.documentId),['voucher1','voucher2']);assert.equal(f.slots()[3].selected.pages,4);
 assert.equal(f.calls.find(c=>c.path==='/api/mail-tickets/search').b.bookingId,'exact-customer');
 assert.equal(f.node('#modal').open,true);assert.match(f.node('#modal').innerHTML,/pagina’s verwijderen en ordenen/);
});
test('retry preserves edited documents and deliberately omitted places',async()=>{
 const f=fixture();f.exec(`draft.body.sections[0].selected={asset:'edited',pages:1};draft.body.sections[1].omitted=true`);
 await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[0].selected.asset,'edited');assert.equal(f.slots()[1].selected,null);
 assert(!f.calls.some(c=>c.path.includes('drive-')));assert(!f.calls.some(c=>c.path==='/api/booking-data/document'&&c.b.documentId==='letter'));
 const count=f.calls.length;await f.exec('autoFillBookingDocuments()');assert.equal(f.calls.length,count);
});
test('ambiguous letters, Drive files and unapproved vouchers require a choice while other chapters continue',async()=>{
 const f=fixture({items:[{id:'a',kind:'letter'},{id:'b',kind:'letter'},{id:'v',kind:'voucher',approved:false}],driveItems:[{id:'a',recommended:true},{id:'b',recommended:true}]});
 await f.exec('autoFillBookingDocuments()');assert.match(f.slots()[0].issue,/Meerdere Sanity-brieven/);assert.match(f.slots()[1].issue,/Meerdere reisschema/);assert.match(f.slots()[3].issue,/Geen gecontroleerde Sanity-vouchers/);assert(f.slots()[2].selected);
 assert(!f.calls.some(c=>c.path==='/api/booking-data/document'||c.path==='/api/booking-documents/drive-load'));
});
test('duplicate booking numbers never pick a Drive customer document automatically',async()=>{
 const f=fixture();f.exec('draft.body.sanityBooking.sameNumberBookings=2');await f.exec('autoFillBookingDocuments()');assert.match(f.slots()[1].issue,/niet uniek/);assert(!f.calls.some(c=>c.path.includes('drive-')));assert(f.slots()[0].selected);
});
test('NS cancellation, missing reference and unavailable PDF never leave partial tickets in the book',async()=>{
 for(const options of [{mail:{references:['ABCDEF'],messages:[{reference:'ABCDEF',latest:true,cancelled:true,tickets:[]}]}},{mail:{references:[],messages:[]}},{failTicket:'b'}]){
  const f=fixture(options);await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[2].selected,null);assert(f.slots()[2].issue);assert(f.slots()[3].selected);
 }
});
test('missing Google permission becomes a chapter issue, not a failure of the other imports',async()=>{
 const f=fixture({api:async path=>{if(path.includes('drive-search'))throw Error('Koppel Google Drive met leestoegang');}});await f.exec('autoFillBookingDocuments()');assert.match(f.slots()[1].issue,/leestoegang/);assert(f.slots()[0].selected);assert(f.slots()[2].selected);assert(f.slots()[3].selected);
});
test('a unique Drive voucher is loaded automatically but must be reviewed before use',async()=>{
 const f=fixture({items:[{id:'letter',kind:'letter'}]});await f.exec('autoFillBookingDocuments()');
 assert.equal(f.slots()[3].selected.documentOrigin,'drive');assert.equal(f.slots()[3].selected.reviewRequired,true);assert.match(f.slots()[3].issue,/Controleer klant/);
 await f.exec('documentSlotPages(3)');f.exec('documentPagesSave({disabled:false})');await f.ctx.lastRun;
 assert(!f.slots()[3].selected.reviewRequired);assert(f.slots()[3].selected.reviewedAt);assert.equal(f.slots()[3].selected.driveDocument.id,'drive');
});
test('failure of a second voucher cannot insert an incomplete hotel voucher set',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/booking-data/document'&&b.documentId==='voucher2')throw Error('Reserveringsnummer ontbreekt');}});
 await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[3].selected,null);assert.match(f.slots()[3].issue,/Reserveringsnummer/);assert(f.slots()[0].selected);
});
test('changing booking or stopping while a render is in flight cannot attach customer documents',async()=>{
 for(const action of ['draft.body.sanityBooking.id="other-customer"','stopBookingDocuments()']){
  let release,entered;const started=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
  const f=fixture({api:async path=>{if(path==='/api/booking-documents/render'){entered();await wait;return {asset:'late',pages:1};}}});
  const run=f.exec('autoFillBookingDocuments()');await started;f.exec(action);release();await run;assert(f.slots().every(s=>!s.selected));assert.equal(f.composed.length,0);
 }
});
test('reordering and removing individual voucher pages preserves every source and checks their newest version',async()=>{
 const f=fixture();await f.exec('autoFillBookingDocuments()');await f.exec('documentSlotPages(3)');f.exec('documentPageMove(0,1);documentPageRemove(2)');
 f.exec('documentPagesSave({disabled:false})');await f.ctx.lastRun;assert.equal(f.slots()[3].selected.pages,3);assert.equal(f.slots()[3].selected.bookingDocuments.length,2);
 assert.deepEqual(f.composed.at(-1).pages.map(p=>p.asset+':'+p.page),['voucher1:1','voucher1:0','voucher2:1']);await f.exec('checkBookingDocumentSources()');
 for(const id of ['voucher1','voucher2'])assert(f.calls.some(c=>c.path==='/api/booking-data/document'&&c.b.documentId===id));
});


test('unapproved vouchers are skipped while approved vouchers load with their missing-field warnings',async()=>{
 const f=fixture({items:[{id:'letter',kind:'letter'},{id:'voucher-unapproved',kind:'voucher',approved:false},{id:'voucher1',kind:'voucher',approved:true}],api:async(path,b)=>{if(path==='/api/booking-documents/render'&&b.document.documentId==='voucher1')return {asset:'voucher1',pages:2,format:b.format,bookingDocument:b.document,warnings:['Reserveringsnummer is leeg gelaten.']};}});
 await f.exec('autoFillBookingDocuments()');const voucher=f.slots()[3];assert(voucher.selected);assert.equal(voucher.issue,undefined);assert.deepEqual(Array.from(voucher.selected.bookingDocuments,d=>d.documentId),['voucher1']);assert(!f.calls.some(c=>c.path==='/api/booking-data/document'&&c.b.documentId==='voucher-unapproved'));
 assert.equal(voucher.selected.warnings.length,2);assert.match(f.node('#modal').innerHTML,/ongecontroleerde voucher is overgeslagen/);assert.match(f.node('#modal').innerHTML,/Reserveringsnummer is leeg gelaten/);
 await f.exec('documentSlotPages(3)');f.exec('documentPageRemove(1);documentPagesSave({disabled:false})');await f.ctx.lastRun;assert.equal(voucher.selected.warnings.length,2);assert.equal(voucher.selected.pages,1);
});

test('a voucher whose approval is withdrawn during import cannot be inserted',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/booking-data/document'&&b.documentId==='voucher1')return {bookingId:b.bookingId,documentId:b.documentId,kind:'voucher',approved:false};}});
 await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[3].selected,null);assert.match(f.slots()[3].issue,/niet meer gecontroleerd/);assert(!f.calls.some(c=>c.path==='/api/booking-documents/render'&&c.b.document.documentId==='voucher1'));
});

test('outbound and return slots share downloads but require independent page choices',async()=>{
 const f=fixture();f.exec(`draft.body.sections[2].ticketPart='outbound';draft.body.sections.push({...structuredClone(draft.body.sections[2]),ticketPart:'return',title:'Terugreis ophalen'})`);
 await f.exec('autoFillBookingDocuments()');const slots=f.slots();assert.equal(slots[2].selected.reviewRequired,true);assert.equal(slots[4].selected.reviewRequired,true);
 assert.equal(f.calls.filter(c=>c.path==='/api/upload?title=A').length,1);
 await f.exec('documentSlotPages(2)');f.exec('documentPageRemove(2);documentPagesSave({disabled:false})');await f.ctx.lastRun;
 assert.equal(slots[2].selected.pages,2);assert(!slots[2].selected.reviewRequired);assert.equal(slots[4].selected.pages,3);assert.equal(slots[4].selected.reviewRequired,true);
 await f.exec('documentSlotPages(2)');f.exec('documentPagesRestore()');assert.equal(f.exec('documentPages.pages.length'),3);
});
test('column preference is passed to automatic letter rendering and accepted by export source checks',async()=>{const f=fixture();f.exec(`draft.body.sections[0].letterLayout='columns'`);await f.exec('autoFillBookingDocuments()');const call=f.calls.find(c=>c.path==='/api/booking-documents/render'&&c.b.document.kind==='letter');assert.equal(call.b.letterLayout,'columns');assert.equal(f.slots()[0].selected.bookingDocuments[0].layout,'treinrondreis-letter-columns-1');await f.exec('checkBookingDocumentSources()');});
test('ÖBB portal-only mails use a staged Drive PDF in the fixed document chapter',async()=>{
 const ref='0726369981792179';const f=fixture({mail:{query:'1234A',references:[ref],messages:[{id:'obb-mail',reference:ref,latest:true,tickets:[],manualLinks:[{url:'https://shop.oebbtickets.at/en/ticket/postcheckout/example'}]}]},api:async(path,b)=>{
  if(path==='/api/tickets/drive-search')return {items:[{id:'drive-obb',reference:ref,title:'Tickets OBB '+ref+'.pdf',updatedAt:'2026-10-11'}]};
  if(path==='/api/tickets/drive-load')return {asset:'original-obb',pages:3};
  if(path==='/api/tickets/inspect'&&b.asset==='original-obb')return {pages:[0,1,2].map(page=>({asset:'original-obb',page,travelDate:'2026-10-09',dateSource:'pdf',dateNeedsReview:false}))};
 }});f.exec("draft.body.sections=[{choice:'document',documentKind:'obbTickets',title:'ÖBB tickets',options:[],selected:null,ticketMoment:1}]");await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[0].selected.pages,3);assert.equal(f.slots()[0].selected.originalPages.length,3);assert.equal(f.calls.find(c=>c.path==='/api/tickets/drive-load').b.query,ref);assert(!f.calls.some(c=>c.ticket));
});

test('distinct departure dates select moments with gaps, same-day tickets stay together and fixed chapters remain',async()=>{
 const f=fixture();f.exec(`draft.body.sections[2].ticketMoment=1;draft.body.sections.push({...structuredClone(draft.body.sections[2]),ticketMoment:2,title:'Terugreistickets'})`);
 await f.exec('autoFillBookingDocuments()');const slots=f.slots();assert.equal(slots[2].selected.pages,2);assert.equal(slots[4].selected.pages,1);assert.equal(slots[4].selected.pageSources[0].travelDate,'2026-10-16');assert(!slots[2].selected.reviewRequired);assert.deepEqual(Array.from(slots,s=>s.documentKind),['letter','schedule','nsTickets','voucher','nsTickets']);assert.equal(f.calls.filter(c=>c.path==='/api/mail-tickets/search').length,1);
 await f.exec('documentSlotPages(2)');f.exec('documentPagesRestore()');f.exec('documentPagesSave({disabled:false})');await assert.rejects(f.ctx.lastRun,/dit reismoment/);f.exec('choosePickerMoment();documentPageMove(0,1);documentPageRemove(1);documentPagesSave({disabled:false})');await f.ctx.lastRun;assert.equal(slots[2].selected.pageSources[0].asset,'uploaded-b');assert.equal(slots[2].selected.originalPages.length,3);assert.equal(slots[4].selected.pageSources[0].asset,'uploaded-c');
});
test('MAV uses the first page of each PDF and different providers have independent imports',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/tickets/inspect'&&b.provider==='mav')return {pages:[0,1].map(page=>({asset:b.asset,page,travelDate:'2026-10-10',dateSource:'pdf',dateNeedsReview:false}))};}});f.exec(`draft.body.sections[2].documentKind='mavTickets';draft.body.sections.push({choice:'document',documentKind:'dbTickets',options:[]})`);await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[2].selected.pages,3);assert(Array.from(f.slots()[2].selected.pageSources).every(p=>p.page===0));assert.deepEqual(f.calls.filter(c=>c.path==='/api/mail-tickets/search').map(c=>c.b.provider),['mav','db']);assert.equal(f.slots()[4].selected.ticketImport.providerKey,'db');
});
test('missing and conflicting dates block moment selection until confirmed, manual confirmations persist to original pages',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/tickets/inspect')return {pages:[{asset:b.asset,page:0,travelDate:'',dateSource:'unknown',dateNeedsReview:true}]};}});f.exec('draft.body.sections[2].ticketMoment=1');await f.exec('autoFillBookingDocuments()');assert(f.slots()[2].selected.reviewRequired);await f.exec('documentSlotPages(2)');f.exec('documentPagesSave({disabled:false})');await assert.rejects(f.ctx.lastRun,/reisdatums/);f.exec(`changePickerDate('document',0,'2026-10-10');changePickerDate('document',1,'2026-10-10');changePickerDate('document',2,'2026-10-16');choosePickerMoment();documentPagesSave({disabled:false})`);await f.ctx.lastRun;assert.equal(f.slots()[2].selected.pages,2);assert(!f.slots()[2].selected.reviewRequired);assert.equal(f.slots()[2].selected.originalPages[2].travelDate,'2026-10-16');
 f.exec(`ticketPick={pages:[{asset:'x',page:0,dateNeedsReview:true}],originalPages:[{asset:'x',page:0,dateNeedsReview:true}]};changePickerDate('ticket',0,'2026-10-10')`);assert.equal(f.exec('ticketPick.originalPages[0].travelDate'),'2026-10-10');assert.equal(f.exec('momentPages(ticketPick.originalPages,{ticketMoment:1}).length'),1);
});
test('voucher moments use check-in dates, sort within the chapter and preserve native source pages',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/booking-data/document'&&b.documentId.startsWith('voucher'))return {bookingId:b.bookingId,documentId:b.documentId,kind:'voucher',approved:true,travelDate:b.documentId==='voucher1'?'2026-10-13':'2026-10-08'};}});f.exec('draft.body.sections[3].voucherMoment=1');await f.exec('autoFillBookingDocuments()');assert.equal(f.slots()[3].selected.pages,2);assert.equal(f.slots()[3].selected.pageSources[0].asset,'voucher2');assert.equal(f.slots()[3].selected.bookingDocuments.length,2);assert.equal(f.slots()[3].selected.originalPages.length,4);assert.equal(f.slots()[3].selected.pageSources[0].travelDate,'2026-10-08');
});
