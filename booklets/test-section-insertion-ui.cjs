const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map();const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',value:'letter',open:false,showModal(){this.open=true},close(){this.open=false}});return nodes.get(s)};
 const ctx=vm.createContext({document:{querySelector:node,querySelectorAll:()=>[]},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout:fn=>fn(),AbortSignal,confirm:()=>true,prompt:()=> 'Nieuwe keuze'});vm.runInContext(source,ctx);
 const exec=s=>vm.runInContext(s,ctx);exec("state={objects:[{id:'first',kind:'block',title:'Voorwoord',revision:1,body:{format:'A4',asset:'first',pages:2}},{id:'added',kind:'block',title:'Wenen',revision:1,body:{format:'A4',asset:'added',pages:3}},{id:'second',kind:'block',title:'Terugreis',revision:1,body:{format:'A4',asset:'second',pages:1}},{id:'shared',kind:'choice',title:'Nightjet',revision:1,body:{format:'A4',slot:{choice:'manual',options:[],selected:null}}}],exports:[],countries:['Nederland']};draft={kind:'template',title:'Voorbeeld',body:{format:'A4',values:{},sections:[snapshot(find('first')),snapshot(find('second'))]}};");
 ctx.renderDraft=()=>{};ctx.drawLibrary=()=>{};ctx.refresh=async()=>{};ctx.run=fn=>fn();
 return {ctx,exec,node,titles:()=>Array.from(exec('draft.body.sections'),s=>s.title)};
}
test('multiple picker additions insert in selection order; undo retains the insertion position',async()=>{
 const f=fixture();await f.ctx.chooseBlock(1);f.ctx.addBlock('added');f.ctx.addBlock('first');assert.deepEqual(f.titles(),['Voorwoord','Wenen','Voorwoord','Terugreis']);assert.equal(f.exec('draft.body.sections[1].pages'),3);
 f.ctx.undoPicker();f.ctx.addBlock('second');assert.deepEqual(f.titles(),['Voorwoord','Wenen','Terugreis','Terugreis']);f.ctx.undoPicker();f.ctx.undoPicker();assert.deepEqual(f.titles(),['Voorwoord','Terugreis']);f.ctx.addBlock('added');assert.deepEqual(f.titles(),['Voorwoord','Wenen','Terugreis']);assert.equal(f.exec('dirty'),true);
});
test('existing end-add buttons reset insertion after cancelling or finishing a positioned picker',async()=>{
 const f=fixture();await f.ctx.chooseBlock(1);f.ctx.closeModal();await f.ctx.chooseBlock();f.ctx.addBlock('added');assert.deepEqual(f.titles(),['Voorwoord','Terugreis','Wenen']);
 await f.ctx.chooseBlock(0);f.ctx.addBlock('added');f.ctx.closeModal();await f.ctx.chooseBlock();f.ctx.addBlock('first');assert.deepEqual(f.titles(),['Wenen','Voorwoord','Terugreis','Wenen','Voorwoord']);
});
test('shared choices and document slots insert directly with their settings and survive serialization',()=>{
 const f=fixture();f.ctx.newChoice(1);assert.match(f.node('#modal').innerHTML,/useSharedChoice\('shared',1\)/);f.ctx.useSharedChoice('shared',1);f.ctx.addDocumentSlot(2);assert.match(f.node('#modal').innerHTML,/createDocumentSlot\(2\)/);f.ctx.createDocumentSlot(2);
 assert.deepEqual(f.titles(),['Voorwoord','Nightjet','Brief ophalen','Terugreis']);assert.equal(f.exec('draft.body.sections[1].choiceSource'),'shared');assert.equal(f.exec('draft.body.sections[2].documentKind'),'letter');f.exec('draft=JSON.parse(JSON.stringify(draft))');assert.deepEqual(f.titles(),['Voorwoord','Nightjet','Brief ophalen','Terugreis']);
 f.ctx.newChoice();assert.match(f.node('#modal').innerHTML,/useSharedChoice\('shared',null\)/);f.ctx.addDocumentSlot();f.ctx.createDocumentSlot();assert.equal(f.titles().at(-1),'Brief ophalen');
});
test('new local manual choices edit the inserted chapter, and route choices preserve their position',()=>{
 const f=fixture();let edited;f.ctx.editChoice=(i,all)=>{edited={i,all}};f.ctx.createLocalChoice(1);f.node('#manualChoice').onclick();assert.deepEqual(edited,{i:1,all:true});assert.deepEqual(f.titles(),['Voorwoord','Nieuwe keuze','Terugreis']);assert.equal(f.exec('draft.body.sections[1].choice'),'manual');
 f.ctx.createLocalChoice(2);f.node('#routeChoice').onclick();assert.equal(f.exec('draft.body.sections[2].choice'),'route');assert.equal(f.exec('draft.body.sections[3].title'),'Terugreis');
});
test('every chapter type has an insertion point, including before the first and after the last',()=>{
 const f=fixture();f.ctx.useSharedChoice('shared',1);f.ctx.createDocumentSlot(2);const html=f.ctx.renderDraftSections();assert.equal((html.match(/class="section-insert"/g)||[]).length,5);for(let i=0;i<=4;i++)assert.match(html,new RegExp('chooseSectionInsertion\\('+i+'\\)'));f.ctx.chooseSectionInsertion(1);assert.match(f.node('#modal').innerHTML,/Voorwoord.*Nightjet/);assert.match(f.node('#modal').innerHTML,/chooseBlock\(1\)/);assert.match(f.node('#modal').innerHTML,/newChoice\(1\)/);assert.match(f.node('#modal').innerHTML,/addDocumentSlot\(1\)/);
 f.exec('draft.body.sections=[]');assert.match(f.ctx.renderDraftSections(),/chooseSectionInsertion\(0\)/);f.ctx.createChoice('Eerste route','route',0);assert.deepEqual(f.titles(),['Eerste route']);
});
