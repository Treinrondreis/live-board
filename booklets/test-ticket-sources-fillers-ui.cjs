const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(options={}){
 const nodes=new Map(),calls=[];let checked=['ns','obb'];
 const node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',checked:false,innerHTML:'',open:false,style:{},showModal(){this.open=true},close(){this.open=false}});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>checked.map(value=>({value}))},window:{addEventListener(){}},crypto:require('node:crypto').webcrypto,URL,structuredClone,console,setTimeout,clearTimeout,AbortSignal,confirm:()=>true});vm.runInContext(source,ctx);
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

test('hotel PDF attachments use original bytes without blanket voucher review',async()=>{
 const f=fixture({api:async(path,b)=>{
  if(path==='/api/booking-data/documents')return {items:[],attachments:[{id:'hotel-file',title:'Hotel',recommended:true}],booking:{todos:[]}};
  if(path==='/api/booking-data/attachment')return {kind:'voucher',originalPdf:'synthetic-only',attachment:true,travelDate:'2026-10-12'};
  if(path==='/api/booking-documents/render')return {asset:'hotel-source',pages:1,bookingDocument:{attachment:true,documentId:'hotel-file',digest:'synthetic'},warnings:[]};
 }});
 f.exec(`draft.body.sections[0].documentKind='voucher';draft.body.sections[0].ticketSources=[]`);
 await f.exec('autoFillBookingDocuments()');assert(!f.slot().selected.reviewRequired);assert.equal(f.slot().selected.documentOrigin,'sanity-attachment');
 assert.equal(f.slot().selected.bookingDocuments[0].attachment,true);assert(!f.slot().issue);
 assert(!f.calls.some(c=>c.path==='/api/booking-documents/drive-search'));
});
test('at least one source suffices, no sources requires explicit omit or upload, fallback avoids extra downloads',async()=>{
 const f=fixture({missing:['ns']});await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,1);assert.equal(f.slot().selected.ticketImport.providerKey,'obb');
 const none=fixture({missing:['ns','obb']});await none.exec('autoFillBookingDocuments()');assert.equal(none.slot().selected,null);assert.match(none.slot().issue,/Geen tickets/);
 const fallback=fixture();fallback.exec("draft.body.sections[0].ticketSourceMode='fallback'");await fallback.exec('autoFillBookingDocuments()');assert.equal(fallback.slot().selected.pages,1);assert(!fallback.calls.some(c=>c.b?.provider==='obb'));
});

test('no pages for the chosen journey never imports opposite-direction tickets or sends an empty composition',async()=>{
 const f=fixture({missing:['obb']});f.exec("draft.body.sanityBooking.journeyDates=['2026-10-12','2026-10-14'];draft.body.sections[0].ticketMoment=1");await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected,null);assert.match(f.slot().issue,/Geen ticketpagina’s gevonden voor reismoment 1/);assert(!f.calls.some(c=>c.path==='/api/tickets/compose'));
});

test('an ÖBB link-only confirmation explains that a ticket PDF must be downloaded first',()=>{
 const f=fixture();assert.throws(()=>f.ctx.autoTicketMessages({provider:'ÖBB',references:['1111222233334444'],messages:[{reference:'1111222233334444',latest:true,tickets:[],manualLinks:[{url:'https://shop.oebbtickets.at/en/ticket/postcheckout/example'}]}]}),/alleen een ticketlink.*download de ticket-PDF/);
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


test('one dead NS PDF button keeps the other tickets as an informational note; no older mail is downloaded',async()=>{
 const f=fixture();f.exec("draft.body.sections[0].ticketSources=['ns'];draft.body.sections.push(structuredClone(draft.body.sections[0]))");
 f.ctx.api=async(path,b)=>{if(path==='/api/mail-tickets/search')return {references:['ABCDEF'],messages:[{id:'new',reference:'ABCDEF',latest:true,tickets:[{id:'valid',title:'Valid'},{id:'dead',title:'Expired'},{id:'valid2',title:'Valid 2'}]},{id:'old',reference:'ABCDEF',latest:false,tickets:[{id:'old',title:'Old'}]}]};if(path.startsWith('/api/upload'))return {id:'pdf-'+b,pages:1};if(path==='/api/tickets/inspect')return {pages:[{asset:b.asset,page:0,mail:'new',reference:'ABCDEF',travelDate:'2026-10-14',dateNeedsReview:false}]};if(path==='/api/tickets/compose')return {asset:'combined',pages:b.pages.length};throw Error(path);};
 const downloads=[];f.ctx.fetch=async(path,r)=>{const id=JSON.parse(r.body).ticket;downloads.push(id);return id==='dead'?{ok:false,json:async()=>({error:'No PDF',code:'TICKET_NOT_PDF'})}:{ok:true,arrayBuffer:async()=>id};};
 await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,2);assert(!f.slot().selected.reviewRequired);assert.match(f.slot().selected.importNotices.join(' '),/Expired.*overgeslagen/);assert.deepEqual(downloads,['valid','dead','valid2']);assert.equal(f.exec('draft.body.sections[1].selected.pages'),2);assert(!f.exec('draft.body.sections[1].selected.reviewRequired'));
});

test('a cancelled reference does not block another reference or fall back to its older mail',async()=>{
 const f=fixture();const report={warnings:[],incomplete:false};const chosen=f.ctx.autoTicketMessages({references:['ABCDEF','GHIJKL'],messages:[{id:'cancel',reference:'ABCDEF',latest:true,cancelled:true,tickets:[]},{id:'old',reference:'ABCDEF',latest:false,tickets:[{id:'old'}]},{id:'current',reference:'GHIJKL',latest:true,tickets:[{id:'valid'}]}]},report);assert.deepEqual(Array.from(chosen,m=>m.id),['current']);assert.match(report.notices.join(' '),/ABCDEF.*geannuleerde referentie/);
});

test('ÖBB portal link is shown directly after failed automatic import, never for older, cancelled or foreign messages',async()=>{
 const link='https://shop.oebbtickets.at/en/ticket/postcheckout/example';
 const f=fixture({api:async path=>{if(path==='/api/mail-tickets/search')return {provider:'ÖBB',references:['1111222233334444'],messages:[{id:'new',reference:'1111222233334444',latest:true,tickets:[],manualLinks:[{url:link},{url:'javascript:alert(1)'},{url:'https://evil.example/ticket'}]},{id:'old',reference:'1111222233334444',latest:false,tickets:[],manualLinks:[{url:link+'-old'}]},{id:'foreign',reference:'9999888877776666',latest:true,tickets:[],manualLinks:[{url:link+'-foreign'}]}]};if(path==='/api/tickets/drive-search')return {items:[]};}});
 f.exec("draft.body.sections[0].ticketSources=['obb']");await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected,null);assert.match(f.slot().issue,/alleen een ticketlink/);const html=f.ctx.documentSlotCard(f.slot(),0);assert.match(html,/ÖBB-ticketpagina openen/);assert(html.includes('href="'+link+'"'));assert(!html.includes('javascript:'));assert(!html.includes('evil.example'));assert(!html.includes('-old'));assert(!html.includes('-foreign'));assert(!JSON.stringify(f.slot()).includes('postcheckout'));
 f.exec('ticketPortalCache.delete(draft.body.sections[0])');assert.match(f.ctx.documentSlotCard(f.slot(),0),/openTicketPortals/);await f.exec('openTicketPortals(0)');await f.ctx.lastRun;assert(f.node('#modal').innerHTML.includes('href="'+link+'"'));
 f.ctx.rememberTicketPortals(f.slot(),{references:['1111222233334444'],messages:[{reference:'1111222233334444',latest:true,cancelled:true,tickets:[],manualLinks:[{url:link}]}]},'obb');assert.equal(f.ctx.ticketPortalActions(f.slot(),0),'');
});

test('a portal link from the previous customer is never rendered after changing bookings',()=>{
 const f=fixture();f.ctx.rememberTicketPortals(f.slot(),{references:['ABCDEF'],messages:[{reference:'ABCDEF',latest:true,tickets:[],manualLinks:[{url:'https://shop.oebbtickets.at/en/ticket/postcheckout/old-customer'}]}]},'obb');assert(f.ctx.ticketPortalActions(f.slot(),0).includes('old-customer'));f.exec("draft.body.sanityBooking.id='other-customer'");assert(!f.ctx.ticketPortalActions(f.slot(),0).includes('old-customer'));
});

test('manual PDF picking also keeps surviving downloads and shows the skipped link before insertion',async()=>{
 const f=fixture();f.ctx.document.querySelectorAll=()=>[{value:'0'}];f.exec("ticketPick={book:draft,bookingId:draft.body.sanityBooking.id,provider:'ns',result:{messages:[{id:'new',reference:'ABCDEF',tickets:[{id:'good',title:'Good'},{id:'dead',title:'Dead'}]}]}};");f.ctx.fetch=async(path,r)=>JSON.parse(r.body).ticket==='dead'?{ok:false,json:async()=>({error:'No PDF',code:'TICKET_NOT_PDF'})}:{ok:true,arrayBuffer:async()=>'good'};f.ctx.ticketPagesDraw=()=>{};f.exec('ticketFetchPDFs({disabled:false})');await f.ctx.lastRun;assert.equal(f.exec('ticketPick.pages.length'),1);assert.match(f.node('#modal').innerHTML,/ABCDEF.*Dead.*overgeslagen/);
});

test('ticket summary groups routes and passengers, deduplicates continuation pages, and never invents unknown counts',()=>{const f=fixture();const selected={ticketImport:{},pageSources:[{asset:'a',page:0,originStation:'Utrecht',destinationStation:'Wien',passengerCount:2,travelDate:'2027-03-01',documentRole:'ticket'},{asset:'a',page:1,originStation:'Utrecht',destinationStation:'Wien',passengerCount:2,travelDate:'2027-03-01',documentRole:'ticket'},{asset:'b',page:0,originStation:'Leiden',destinationStation:'Utrecht',passengerCount:1,documentRole:'ticket'},{asset:'c',page:0,originStation:'Leiden',destinationStation:'Utrecht',passengerCount:1,documentRole:'ticket'},{asset:'d',page:0,documentRole:'unknown'}]};const rows=f.ctx.ticketSummaryRows(selected);assert.equal(rows.length,3);assert.equal(rows[0].count,1);assert.equal(rows[0].persons,2);assert.equal(rows[1].count,2);assert.match(f.ctx.ticketSummary(selected),/aantal personen niet herkend/);assert.match(f.ctx.ticketSummary(selected),/2× Leiden/);});

test('refreshing ticket display metadata preserves manually confirmed dates and page selection',async()=>{const f=fixture({api:async(path,b)=>{if(path==='/api/tickets/inspect')return {pages:[{asset:b.asset,page:0,originStation:'Delft',destinationStation:'Utrecht',passengerCount:2,travelDate:'2020-01-01'}]};}});f.exec("draft.body.sections[0].selected={ticketImport:{providerKey:'ns'},asset:'combined',pages:1,pageSources:[{asset:'source',page:0,providerKey:'ns',travelDate:'2027-03-01',dateManuallyConfirmed:true}],originalPages:[{asset:'source',page:0,providerKey:'ns',travelDate:'2027-03-01'}]}");await f.ctx.refreshTicketSummary(0,{disabled:false});assert.equal(f.slot().selected.pageSources[0].travelDate,'2027-03-01');assert.equal(f.slot().selected.pageSources[0].dateManuallyConfirmed,true);assert.equal(f.slot().selected.pageSources[0].passengerCount,2);assert.equal(f.slot().selected.originalPages[0].originStation,'Delft');assert.equal(f.slot().selected.pages,1);});
test('legacy false ÖBB alarms for an imported NS code become nonblocking, genuine missing references stay',()=>{const f=fixture();const make=ref=>({sections:[{documentKind:'combinedTickets',issue:'Niet alle tickets konden worden opgehaald. Controleer de melding en de opgehaalde pagina’s via Pagina’s kiezen / ordenen.',selected:{ticketImport:{providerKey:'ns',references:['ABCDEFG']},reviewRequired:true,pageSources:[{travelDate:'2027-03-01',dateNeedsReview:false}],warnings:['ÖBB: ÖBB '+ref+': geen actuele mail met bestaande ticket-PDF’s gevonden. Controleer de mails of upload de juiste PDF.']}}]});const body=make('ABCDEFG');assert(f.ctx.clearLegacyTicketNotices(body));assert(!body.sections[0].selected.reviewRequired);assert(!body.sections[0].issue);const genuine=make('HIJKLMN');assert(!f.ctx.clearLegacyTicketNotices(genuine));assert(genuine.sections[0].selected.reviewRequired);});

test('a blocked issued ÖBB PDF exposes the direct download action, including after a saved-book reload',async()=>{const url='https://shop.oebbtickets.at/en/ticket/voucher/fixture-id';const f=fixture({api:async(path,b)=>{if(path==='/api/mail-tickets/search')return {provider:'ÖBB',references:['1111222233334444'],messages:[{id:'issued',reference:'1111222233334444',latest:true,tickets:[{id:'pdf',title:'PDF'}],manualLinks:[{url}]}]};}});f.exec("draft.body.sections[0].ticketSources=['obb']");f.ctx.fetch=async()=>({ok:false,json:async()=>({code:'TICKET_REMOTE_BLOCKED',error:'ÖBB weigert de automatische download (HTTP 403).'})});await f.exec('autoFillBookingDocuments()');assert.match(f.slot().issue,/403/);assert.match(f.ctx.documentSlotCard(f.slot(),0),/ÖBB-PDF downloaden/);f.exec('ticketPortalCache.delete(draft.body.sections[0])');await f.ctx.openTicketPortals(0);assert(f.node('#modal').innerHTML.includes('href="'+url+'"'));});

test('a verified NS download resolves the same candidate at DB without false missing-ticket alarm in either order',async()=>{
 for(const order of [['ns','db'],['db','ns']]){const f=fixture({api:async(path,b)=>{if(path==='/api/tickets/drive-search')return {items:[]};if(path==='/api/mail-tickets/search')return {provider:b.provider,references:['ABCDEF'],messages:b.provider==='ns'?[{id:'ns',reference:'ABCDEF',latest:true,tickets:[{id:'ns',title:'Ticket'}]}]:[]};}});f.exec('draft.body.sections[0].ticketSources='+JSON.stringify(order));await f.exec('autoFillBookingDocuments()');assert.equal(f.slot().selected.pages,1);assert(!f.slot().selected.reviewRequired);assert.equal(f.slot().selected.warnings.length,0);}
});
test('a distinct missing reference stays visible and missing mail differs from mail without a PDF',async()=>{
 const f=fixture({api:async(path,b)=>{if(path==='/api/tickets/drive-search')return {items:[]};if(path==='/api/mail-tickets/search')return {provider:b.provider,references:[b.provider==='ns'?'ABCDEF':'GHIJKL'],messages:b.provider==='ns'?[{id:'ns',reference:'ABCDEF',latest:true,tickets:[{id:'ns',title:'Ticket'}]}]:[]};}});await f.exec('autoFillBookingDocuments()');assert(f.slot().selected.reviewRequired);assert.match(f.slot().selected.warnings.join(' '),/GHIJKL.*geen passende ticketmail/);
 const report={warnings:[],notices:[]};f.ctx.autoTicketMessages({references:['ABCDEF'],messages:[{id:'empty',reference:'ABCDEF',latest:true,tickets:[]}]},report,true);assert.match(report.missing[0].message,/mail gevonden.*geen ondersteunde ticket-PDF/);
 assert.match(f.ctx.documentSlotCard(f.slot(),0),/Ticketmails zoeken/);
});
