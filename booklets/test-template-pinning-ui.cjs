const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
test('template pins persist, pinned cards lead and thumbnail uses the first page',async()=>{
 const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:false});return nodes.get(s);};
 const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,setTimeout,clearTimeout});
 const source=fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,'');vm.runInContext(source,ctx);
 const exec=s=>vm.runInContext(s,ctx);
 exec(`state={objects:[{id:'first',kind:'template',title:'Eerst',revision:1,body:{sections:[]}},{id:'pinned',kind:'template',title:'Vastgezet',revision:4,body:{pinned:true,sections:[{asset:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}]}}],exports:[]};view='templates';render()`);
 let html=node('#main').innerHTML;assert(html.indexOf('<h3>Vastgezet')<html.indexOf('<h3>Eerst'));
 assert(html.includes('/files/preview/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/0'));assert(html.includes('aria-pressed="true"'));assert(html.includes('Vastgezet · losmaken'));
 let saved;ctx.api=async(path,payload)=>{assert.equal(path,'/api/save');saved=payload;};ctx.refresh=async()=>{};ctx.run=fn=>fn();
 await ctx.toggleTemplatePin('pinned');assert.equal(saved.body.pinned,false);assert.equal(saved.revision,4);assert.equal(exec("find('pinned').body.pinned"),true);
});
