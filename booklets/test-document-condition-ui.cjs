const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{value:'',innerHTML:'',style:{},showModal(){},close(){}});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[{value:'ns'}]},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout,AbortSignal});vm.runInContext(source,ctx);node('#slotTicketSourceMode').value='all';
 const exec=s=>vm.runInContext(s,ctx);exec(`state={objects:[]};draft={kind:'book',body:{format:'A4',values:{},sanityBooking:{id:'customer'},sections:[{choice:'document',documentKind:'nsTickets',title:'Nightjet',ticketMoment:2,selected:null},{choice:'document',documentKind:'nsTickets',title:'Aansluiting naar huis',ticketMoment:3,todoCondition:'CORA2',selected:null}]}}`);
 ctx.todos=[];ctx.api=async()=>({booking:{todos:ctx.todos},items:[]});ctx.renderDraft=()=>{};ctx.bookingDocumentsOverview=()=>{};ctx.autoLoadProgress=()=>{};
 ctx.loaded=[];ctx.autoTicketDocument=async(p,slot)=>{ctx.loaded.push(slot.title);slot.selected={title:slot.title,asset:'test',pages:1};};
 return {ctx,exec,node};
}
test('absent condition skips only the optional chapter and clears earlier customer pages',async()=>{
 const f=fixture();f.exec("draft.body.sections[1].selected={asset:'old',pages:1}");await f.exec('autoFillBookingDocuments()');
 assert.deepEqual(f.ctx.loaded,['Nightjet']);assert.equal(f.exec('draft.body.sections[1].selected'),null);assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),true);assert.equal(f.exec('activeSections().length'),1);
 assert.match(f.exec('documentSlotCard(draft.body.sections[1],1)'),/Overgeslagen: geen ToDo met CORA2/);
});
test('full phrase in a single ToDo activates moment 3 without changing moment 2',async()=>{
 const f=fixture();f.ctx.todos=[{title:'Binnenlandse aansluiting',description:'Boek cora2 naar huis'}];await f.exec('autoFillBookingDocuments()');
 assert.deepEqual(f.ctx.loaded,['Nightjet','Aansluiting naar huis']);assert.equal(f.exec('draft.body.sections[1].ticketMoment'),3);assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
 f.ctx.todos=[];await f.exec('checkDocumentConditions()');assert.equal(f.exec('activeSections().length'),1);
 f.ctx.todos=[{title:'CORA2 extra tekst'}];await f.exec('autoFillBookingDocuments()');assert.equal(f.exec('activeSections().length'),2);
});
test('changed condition and customer cannot reuse an earlier skip result',async()=>{
 const f=fixture();await f.exec('checkDocumentConditions()');f.exec("draft.body.sections[1].todoCondition='CORA3'");assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
 f.exec("draft.body.sections[1].todoCondition='CORA2';draft.body.sanityBooking.id='other'");assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
 f.exec('clearDocumentSlots(draft.body)');assert.equal(f.exec('draft.body.sections[1].todoConditionState'),undefined);assert.equal(f.exec('draft.body.sections[1].todoCondition'),'CORA2');
});
test('failed ToDo reads are errors, never interpreted as absence; other imports continue',async()=>{
 const f=fixture();f.ctx.api=async()=>{throw Error('Sanity tijdelijk onbereikbaar');};await f.exec('autoFillBookingDocuments()');assert.deepEqual(f.ctx.loaded,['Nightjet']);assert.match(f.exec('draft.body.sections[1].issue'),/onbereikbaar/);assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
 await assert.rejects(f.exec('checkBookingDocumentSources()'),/onbereikbaar/);
 f.ctx.api=async()=>({items:[]});await assert.rejects(f.exec('checkDocumentConditions()'),/niet worden gecontroleerd/);
});
test('a matching condition with no ticket remains an unresolved required chapter',async()=>{
 const f=fixture();f.ctx.todos=[{title:'CORA2'}];f.ctx.autoTicketDocument=async()=>{throw Error('Geen tickets gevonden');};await f.exec('autoFillBookingDocuments()');assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);assert.match(f.exec('draft.body.sections[1].issue'),/Geen tickets/);
});
test('late ToDo results cannot apply to another booking',async()=>{
 const f=fixture();let release;f.ctx.api=()=>new Promise(r=>release=r);const pending=f.exec('checkDocumentConditions()');f.exec("draft.body.sanityBooking={id:'other'}");release({booking:{todos:[]}});await assert.rejects(pending,/boeking is gewijzigd/);assert.equal(f.exec('draft.body.sections[1].todoConditionState'),undefined);
});
test('settings expose and preserve an optional ToDo phrase',()=>{
 const f=fixture();f.exec('documentSlotSettings(1)');assert.match(f.node('#modal').innerHTML,/id="slotTodoCondition" maxlength="300" value="CORA2"/);
 for(const [id,value] of [['#slotTitle','Aansluiting'],['#slotToc','Naar huis'],['#slotNumberX','89'],['#slotNumberY','95'],['#slotDateMoment','3'],['#slotTicketPart','all'],['#slotTodoCondition',' CORA2 ']])f.node(id).value=value;
 f.exec('saveDocumentSlotSettings(1)');assert.equal(f.exec('draft.body.sections[1].todoCondition'),'CORA2');assert.equal(f.exec('draft.body.sections[1].ticketMoment'),3);
});
test('template and unbound book show the condition without a customer result',()=>{
 const f=fixture();f.exec("draft.kind='template';delete draft.body.sanityBooking");assert.match(f.exec('documentSlotCard(draft.body.sections[1],1)'),/Alleen bij ToDo/);assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
 f.exec("draft.kind='book'");assert.match(f.exec('documentSlotCard(draft.body.sections[1],1)'),/ToDo-voorwaarden controleren/);
});
test('a failed fresh check invalidates a previously confirmed skip',async()=>{
 const f=fixture();await f.exec('checkDocumentConditions()');assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),true);
 f.ctx.api=async()=>{throw Error('Onbereikbaar');};await assert.rejects(f.exec('checkDocumentConditions()'),/Onbereikbaar/);assert.equal(f.exec('documentConditionSkipped(draft.body.sections[1])'),false);
});
