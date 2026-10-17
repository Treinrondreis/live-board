const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');
function fixture(){
 const nodes=new Map(),calls=[],node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',open:false,showModal(){this.open=true},close(){this.open=false}});return nodes.get(s)};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout,AbortSignal,confirm:()=>true});vm.runInContext(source,ctx);
 const exec=code=>vm.runInContext(code,ctx);exec("state={objects:[],exports:[]};draft={id:'synthetic-book',kind:'book',body:{sections:[],values:{}}}");
 const setting={enabled:true,canCreate:true,folderName:'Treinrondreis - Reisboekjes',stored:2,remaining:['old-1','old-2'],localBytes:2000000000};
 ctx.run=fn=>fn();ctx.renderDraft=()=>{};ctx.refresh=async()=>{};ctx.toast=()=>{};ctx.api=async(path,body)=>{calls.push({path,body});return structuredClone(setting)};
 return {ctx,node,calls,setting,exec};
}
test('storage settings limit scope to generated PDFs and retain sources and permissions',async()=>{
 const f=fixture();await f.ctx.exportStorageSettings();const html=f.node('#modal').innerHTML;
 assert.match(html,/Alleen de gemaakte boekjes-PDF’s/);assert.match(html,/Bouwstenen, bron-PDF’s/);assert.match(html,/Deelrechten worden niet aangepast/);assert.match(html,/2 lokale PDF’s · 2.00 GB/);assert.match(html,/Eerdere PDF’s naar Drive verplaatsen/);
 f.setting.canCreate=false;await f.ctx.exportStorageSettings();assert.match(f.node('#modal').innerHTML,/opslagtoestemming geven/);
});
test('transfer stops at failure and can resume instead of regenerating exports',async()=>{
 const f=fixture();f.node('#modal').open=true;let transferred=0;
 f.ctx.api=async(path,body)=>{f.calls.push({path,body});if(path==='/api/export-storage')return structuredClone(f.setting);if(++transferred===2)throw Error('Synthetic Drive unavailable');return {ok:true}};
 const button={disabled:false};await assert.rejects(f.ctx.migrateExportPdfs(button),/Synthetic/);
 assert.equal(button.disabled,false);assert.equal(f.exec('exportArchiveRun'),null);assert.match(f.node('#exportArchiveProgress').textContent,/1 PDF’s verplaatst/);
 assert.deepEqual(f.calls.filter(c=>c.path==='/api/export-archive').map(c=>c.body.id),['old-1','old-2']);assert.ok(f.calls.every(c=>c.path!=='/api/export'));
});
test('stop after current PDF and closing modal prevent further transfers',async()=>{
 for(const close of [false,true]){const f=fixture();f.node('#modal').open=true;let n=0;
 f.ctx.api=async(path)=>{if(path==='/api/export-storage')return structuredClone(f.setting);n++;if(close)f.node('#modal').open=false;else f.exec('exportArchiveRun.stop=true');return {ok:true}};
 await f.ctx.migrateExportPdfs({disabled:false});assert.equal(n,1);assert.equal(f.node('#modal').open,!close);}
});
test('history shows storage state with unchanged private export and digital links',()=>{
 const f=fixture();f.exec("state.exports=[{id:'drive-id',book_id:'synthetic-book',created:'Today',driveStored:1,report:{pages:4}},{id:'local-id',book_id:'synthetic-book',created:'Yesterday',report:{pages:4}}]");
 const html=f.ctx.exportHistoryPanel();assert.match(html,/Opgeslagen in Google Drive/);assert.match(html,/Opgeslagen op de server/);assert.match(html,/href="\/files\/export\/drive-id"/);assert.match(html,/href="\/digital\/drive-id"/);assert.doesNotMatch(html,/archiveExport\('drive-id'/);assert.match(html,/archiveExport\('local-id'/);
});
