const fs=require('fs'),vm=require('vm'),assert=require('assert');
const nodes=new Map(),node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',open:true,showModal(){},close(){}});return nodes.get(s)};
const ctx=vm.createContext({document:{querySelector:node},window:{addEventListener(){}},structuredClone,console,clearTimeout,setTimeout,confirm:()=>true});
vm.runInContext(fs.readFileSync(__dirname+'/index.html','utf8').split('<script>')[2].split('</script>')[0].replace(/init\(\)\.catch\(e=>\{[^\n]+/,''),ctx);
ctx.autoFillBookingDocuments=async()=>{}; // Automatic import is exercised in test-auto-booking-ui.cjs.
vm.runInContext(`state={objects:[],exports:[]};draft={kind:'book',title:'',body:{sections:[{choice:'document',documentKind:'letter',title:'Sanity-brief',selected:{asset:'old',pages:2}}],values:{},sanityBooking:{id:'old'}}};bookingLookup={book:draft,items:[{id:'new',number:'1234',name:'Test <script>',trip:'Testreis',values:{klantvoornaam:'Test'}}]};bindSanityBooking(0)`,ctx);
assert.equal(vm.runInContext('draft.body.sanityBooking.id',ctx),'new');assert.equal(vm.runInContext('draft.body.values.klantvoornaam',ctx),'Test');assert.equal(vm.runInContext('draft.body.sections[0].selected',ctx),null);
const bookCard=vm.runInContext('documentSlotCard(draft.body.sections[0],0)',ctx);assert(bookCard.includes('PDF uploaden'));assert(bookCard.includes('Document kiezen / ophalen'));
vm.runInContext('omitDocumentSlot(0)',ctx);assert.equal(vm.runInContext('draft.body.sections[0].omitted',ctx),true);
vm.runInContext(`draft.kind='template'`,ctx);assert(!vm.runInContext('documentSlotCard(draft.body.sections[0],0)',ctx).includes('PDF uploaden'));
assert(node('#main').innerHTML.includes('Test &lt;script&gt;'));
assert.throws(()=>vm.runInContext(`slotCurrent({book:draft,slot:draft.body.sections[0],bookingId:'different'})`,ctx),/gewijzigd/);
console.log('Booking selection, safe customer previews, document slots, template privacy and stale-import guards verified.');
