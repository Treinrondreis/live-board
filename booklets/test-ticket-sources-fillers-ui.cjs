const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(options={}){
 const nodes=new Map(),calls=[];let checked=['ns','obb'];
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',checked:false,innerHTML:'',open:false,style:{},showModal(){this.open=true},close(){this.open=false}});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>checked.map(value=>({value}))},window:{addEventListener(){}},crypto:require('node:crypto').webcrypto,structuredClone,console,setTimeout,clearTimeout,AbortSignal,confirm:()=>true});vm.runInContext(source,ctx);
 const exec=code=>vm.runInContext(code,ctx);
 exec(`state={objects:[],exports:[]};draft={kind:'book',title:'Test',body:{format:'A4',values:{},sanityBooking:{id:'customer',number:'1234A',name:'Test'},sections:[{choice:'document',documentKind:'combinedTickets',ticketSources:['ns','obb'],ticketSourceMode:'all',title:'Tickets',selected:null,options:[]}]}}`);
 ctx.api=async(path,b)=>{calls.push({path,b:structuredClone(b)});if(options.api){const r=await options.api(path,b);if(r!==undefined)return r;}
  if(path==='/api/mail-tickets/search'){if(options.missing?.includes(b.provider))return {references:[],messages:[]};return {references:[b.provider+'-REF'],messages:[{id:b.provider,reference:b.provider+'-REF',latest:true,tickets:[{id:b.provider,title:'TICKET-'+b.provider+'.pdf'}]}]};}
  if(path.startsWith('/api/upload'))return {id:'pdf-'+b,pages:options.pdfPages||1};
  if(path==='/api/tickets/inspect')return {pages:Array.from({length:options.pdfPages||1},(_,page)=>({asset:b.asset,page,travelDate:b.provider==='ns'?'2026-10-14':'2026-10-12',dateNeedsReview:false,dateSource:'pdf',documentRole:'ticket',departureTime:'10:00'}))};
  if(path==='/api/tickets/compose')return {asset:'composed',pages:b.pages.length,format:'A4'};
  throw Error('Unexpected '+path);
 };
 ctx.fetch=async(path,r)=>{const ticket=JSON.parse(r.body).ticket;calls.push({ticket});if(ticket===options.fail)throw Error('PDF niet beschikbaar');return {ok:true,arrayBuffer:async()=>ticket};};
 ctx.run=fn=>{ctx.lastRun=Promise.resolve().then(fn);return ctx.lastRun;};ctx.renderDraft=()=>{};ctx.bookingDocumentsOverview=()=>{};ctx.toast=m=>ctx.message=m;
 return {ctx,exec,node,calls,check:v=>checked=v,slot:()=>exec('draft.body.sections[0]')};
}
test('combines NS and another provider, sorts by journey date and preserves both origins',async()=>{
 const f=fixture();f.exec("draft.body.sections[0].ticketSources=['ns','db']");await f.exec('autoFillBookingDocuments()');
 const selected=f.slot().selected;assert.equal(selected.pages,2);assert.deepEqual(Array.from(selected.pageSources,p=>p.providerKey),['db','ns']);assert.equal(selected.ticketImport.providers.length,2);assert.equal(selected.reviewRequired,undefined);
});

test('NS first source date can be the second journey date after another carrier',()=>{
 const f=fixture();f.exec(`draft.body.sanityBooking.journeyDates=['2026-10-12','2026-10-18'];draft.body.sections[0].ticketMoment=2`);
 const result=f.exec(`momentPages([{asset:'return',page:0,travelDate:'2026-10-18',dateNeedsReview:false}],draft.body.sections[0])`);
 assert.equal(result.length,1);assert.equal(result[0].travelDate,'2026-10-18');
 f.exec(`draft.body.sections[0].ticketDateBasis='source'`);
 assert.throws(()=>f.exec(`momentPages([{asset:'return',page:0,travelDate:'2026-10-18'}],draft.body.sections[0])`),/bestaat niet/);
});

test('hotel PDF attachments use original bytes and remain blocked until voucher review',async()=>{
 const f=fixture({api:async(path,b)=>{
  if(path==='/api/booking-data/documents')return {items:[],attachments:[{id:'hotel-file',title:'Hotel',recommended:true}],booking:{todos:[]}};
  if(path==='/api/booking-data/attachment')return {kind:'voucher',originalPdf:'synthetic-only',attachment:true,travelDate:'2026-10-12'};
  if(path==='/api/booking-documents/render')return {asset:'hotel-source',pages:1,bookingDocument:{attachment:true,documentId:'hotel-file',digest:'synthetic'},warnings:[]};
 }});
 f.exec(`draft.body.sections[0].documentKind='voucher';draft.body.sections[0].ticketSources=[]`);
 await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.reviewRequired,true);assert.equal(f.slot().selected.documentOrigin,'sanity-attachment');
 assert.equal(f.slot().selected.bookingDocuments[0].attachment,true);assert.match(f.slot().issue,/Originele hotel-PDF/);
 assert(!f.calls.some(c=>c.path==='/api/booking-documents/drive-search'));
});
test('at least one source suffices, no sources requires explicit omit or upload, fallback avoids extra downloads',async()=>{
 const f=fixture({missing:['ns']});await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,1);assert.equal(f.slot().selected.ticketImport.providerKey,'obb');
 const none=fixture({missing:['ns','obb']});await none.exec('autoFillBookingDocuments()');assert.equal(none.slot().selected,null);assert.match(none.slot().issue,/Geen tickets/);
 const fallback=fixture();fallback.exec("draft.body.sections[0].ticketSourceMode='fallback'");await fallback.exec('autoFillBookingDocuments()');assert.equal(fallback.slot().selected.pages,1);assert(!fallback.calls.some(c=>c.b?.provider==='obb'));
});
test('supplemental failures are visible, no partial pages from a failed provider and retry is atomic',async()=>{
 const f=fixture({fail:'obb'});await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,1);assert.match(f.slot().selected.warnings[0],/ÖBB.*PDF niet beschikbaar/);
 const old=f.slot().selected;f.ctx.fetch=async()=>{throw Error('Unavailable');};await f.exec('autoFillBookingDocuments(draft.body.sections[0])');assert.equal(f.slot().selected,old);assert.match(f.slot().issue,/Unavailable/);
});
test('MAV imports one page per PDF and duplicate moments share downloads',async()=>{
 const f=fixture({pdfPages:3});f.exec("draft.body.sections[0].ticketSources=['mav'];draft.body.sections.push(structuredClone(draft.body.sections[0]))");await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,1);assert.equal(f.calls.filter(c=>c.ticket).length,1);
});
test('known times order journeys and tickets precede reservations; unknown order only warns',()=>{
 const f=fixture();const rows=f.exec(`datedPages([{travelDate:'2026-10-12',documentRole:'reservation',departureTime:'10:00'},{travelDate:'2026-10-12',documentRole:'ticket',departureTime:'10:00'},{travelDate:'2026-10-12',documentRole:'ticket',departureTime:'09:00'}])`);assert.deepEqual(Array.from(rows,p=>p.departureTime+'/'+p.documentRole),['09:00/ticket','10:00/ticket','10:00/reservation']);
 assert.equal(f.exec(`ticketOrderWarnings([{travelDate:'2026-10-12'},{travelDate:'2026-10-12'}]).length`),1);
});
test('stopping or changing customer during supplemental download cannot insert a partial set',async()=>{
 let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=fixture({api:async(path,b)=>{if(path==='/api/mail-tickets/search'&&b.provider==='obb'){entered();await wait;}}});
 const work=f.exec('autoFillBookingDocuments()');await started;f.exec('draft.body.sanityBooking.id="different"');release();await work;assert.equal(f.slot().selected,null);assert(!f.calls.some(c=>c.path==='/api/tickets/compose'));
});
test('source settings require one source, persist preference and filler settings survive library refresh',()=>{
 const f=fixture();f.exec('documentSlotSettings(0)');assert.match(f.node('#modal').innerHTML,/Alle beschikbare bronnen combineren/);
 for(const [id,value] of Object.entries({slotNumberX:'89',slotNumberY:'95',slotDateMoment:'0',slotTicketSourceMode:'all',slotFirstTicketSource:'db',slotTitle:'Treintickets',slotToc:'Tickets',slotTicketPart:'all',slotTodoCondition:''}))f.node('#'+id).value=value;
 f.check([]);f.exec('saveDocumentSlotSettings(0)');assert.match(f.ctx.message,/minstens één/);f.check(['ns','db']);f.exec('saveDocumentSlotSettings(0)');assert.deepEqual(Array.from(f.slot().ticketSources),['db','ns']);
 f.exec(`draft.body.sections=[{block:'extra',title:'Extra',asset:'a',pages:1,fields:[],tripFiller:true,fillerRequiredDays:5,fillerPriority:12}];state.objects=[{id:'extra',kind:'block',revision:2,title:'Updated',body:{asset:'b',pages:1,fields:[]}}];refreshDraftBlocks()`);
 assert.equal(f.slot().fillerRequiredDays,5);assert.equal(f.slot().fillerPriority,12);f.exec('tripFillerSettings(0)');assert.match(f.node('#modal').innerHTML,/Beide reisdagen tellen mee/);
});
test('export fill toggle rechecks optional fields and preserves an unchecked choice',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/export-plan')return {pages:5,needed:3,missing:[],fillers:[],canFill:true,droppedFillers:['Extra Vienna'],fillRequested:b.fill,errors:b.fill?[]:[{section:2,title:'Extra Vienna',message:'Verplicht veld ontbreekt'}]};}});
 f.exec(`exportPlan={pages:5,needed:3,missing:[],fillers:[],canFill:true,droppedFillers:['Extra Vienna'],fillRequested:true,errors:[]};renderExportCheck(exportPlan)`);
 assert.match(f.node('#modal').innerHTML,/Weglaten op hun vaste plek: Extra Vienna/);
 f.ctx.cb={checked:false,disabled:false};await f.exec('reviewExportFill(cb)');assert.equal(f.exec('exportPlan.fillRequested'),false);assert.match(f.node('#modal').innerHTML,/Verplicht veld ontbreekt/);assert(!/id="fillPages" checked/.test(f.node('#modal').innerHTML));
 f.ctx.cb.checked=true;await f.exec('reviewExportFill(cb)');assert.equal(f.exec('exportPlan.errors.length'),0);
});
