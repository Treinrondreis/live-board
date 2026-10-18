const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),calls=[],timers=[];
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{innerHTML:'',open:true,scrollTop:800,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},focus:o=>calls.push({focus:id,options:o}),scrollIntoView:o=>calls.push({scroll:id,options:o}),showModal(){this.open=true}});}return nodes.get(id);};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,setTimeout:fn=>timers.push(fn),clearTimeout(){}});vm.runInContext(source,ctx);const exec=s=>vm.runInContext(s,ctx);
 exec(`state={objects:[],exports:[]};draft={kind:'book',body:{sections:[{title:'Voorpagina',asset:'generic',pages:1,fields:[]},{choice:'document',documentKind:'combinedTickets',title:'Heenreis <test>',issue:'Ticket-PDF ontbreekt <test>',selected:null},{choice:'document',documentKind:'voucher',title:'Hotel',selected:{reviewRequired:true,pages:1}},{choice:'document',title:'Overgeslagen',omitted:true,issue:'oude fout'},{choice:'document',title:'Niet van toepassing',todoCondition:'CORA',todoConditionState:{matches:false,text:'CORA',bookingId:'booking'},issue:'oude fout'}],sanityBooking:{id:'booking'}}}`);
 ctx.closeModal=()=>calls.push('close');ctx.renderDraft=()=>calls.push('render');return {ctx,exec,node,calls,timers};
}
test('summary shows actionable problems, escapes messages and excludes omitted or inapplicable documents',()=>{
 const f=fixture(),html=f.ctx.bookIssueSummary();assert.match(html,/2 aandachtspunten/);assert.match(html,/Heenreis &lt;test&gt;/);assert.match(html,/ontbreekt &lt;test&gt;/);assert.match(html,/goToBookIssue\(1,false\)/);assert(!html.includes('oude fout'));assert(!html.includes('<test>'));
 assert.match(f.ctx.bookIssueSummary(true),/goToBookIssue\(2,true\)/);
 f.exec('draft.body.sections=[]');assert.equal(f.ctx.bookIssueSummary(),'');
});
test('jump focuses and highlights the exact section and removes the temporary highlight',()=>{
 const f=fixture();f.ctx.goToBookIssue(1);assert.deepEqual(f.calls.slice(0,2),['close','render']);assert.equal(f.calls[2].focus,'#draft-section-1');assert.equal(f.calls[3].scroll,'#draft-section-1');assert(f.node('#draft-section-1').classList.contains('issue-highlight'));f.timers[0]();assert(!f.node('#draft-section-1').classList.contains('issue-highlight'));
});
test('overview jump stays in the open dialog; invalid or removed sections are ignored',()=>{
 const f=fixture();f.ctx.goToBookIssue(2,true);assert(!f.calls.includes('close'));assert(!f.calls.includes('render'));assert.equal(f.calls[1].scroll,'#document-issue-2');const count=f.calls.length;for(const i of [-1,99,'1'])f.ctx.goToBookIssue(i);assert.equal(f.calls.length,count);
});
test('section targets remain tied to current positions after reordering',()=>{
 const f=fixture();f.ctx.draftSectionCard=s=>`<article>${s.title}</article>`;const html=f.ctx.renderDraftSections();assert.match(html,/id="draft-section-1" tabindex="-1"><article>Heenreis/);f.exec('draft.body.sections.reverse()');assert.match(f.ctx.renderDraftSections(),/id="draft-section-4" tabindex="-1"><article>Voorpagina/);
});
test('document overview starts at the summary and PDF preflight links directly to the faulty section',()=>{
 const f=fixture();f.ctx.bookingDocumentsOverview();assert.equal(f.node('#modal').scrollTop,0);assert.match(f.node('#modal').innerHTML,/id="document-issue-1"/);assert.match(f.node('#modal').innerHTML,/Ga naar dit onderdeel/);
 f.ctx.renderExportCheck({pages:4,missing:[],needed:0,fillers:[],errors:[{section:1,title:'Heenreis',message:'PDF ontbreekt'}]});assert.match(f.node('#modal').innerHTML,/onclick="goToBookIssue\(1\)"/);
});
