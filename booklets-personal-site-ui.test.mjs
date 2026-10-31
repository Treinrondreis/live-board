import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./booklets/index.html',import.meta.url),'utf8');
function fixture(){const modal={open:false,innerHTML:'',showModal(){this.open=true}},copied=[],book={id:'example'},id='a'.repeat(32),ctx={URL,draft:book,bookletDialogEpoch:1,location:{origin:'https://example.test'},navigator:{clipboard:{writeText:async s=>copied.push(s)}},$:()=>modal,run:fn=>fn(),esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),toast:()=>{},api:async()=>({url:'/seinhuis/boekjesmaker/reis/'+'b'.repeat(32),code:'ABCDEFGH23',expires:'2028-06-30',revoked:false})};runInNewContext('let personalWebsiteCurrent=null;\n'+['personalWebsiteAction','managePersonalWebsite','copyPersonalWebsite'].map(name=>source.split('\n').find(l=>l.startsWith('function '+name+'('))).join('\n'),ctx);return {ctx,modal,copied,book,id};}
test('website management displays safe link/code, can be copied and follows the current book',async()=>{
 const f=fixture();await f.ctx.managePersonalWebsite(f.id);assert(f.modal.innerHTML.includes('ABCDEFGH23'));assert(f.modal.innerHTML.includes('Toegang uitzetten'));await f.ctx.copyPersonalWebsite();assert(f.copied[0].includes('https://example.test/seinhuis/boekjesmaker/reis/'));assert(f.copied[0].includes('Toegangscode: ABCDEFGH23'));f.ctx.draft={id:'another'};await f.ctx.copyPersonalWebsite();assert.equal(f.copied.length,1);
});
test('a late website response cannot reveal the previous booking and disabled sites have no share action',async()=>{
 const f=fixture();let release;f.ctx.api=()=>new Promise(r=>release=r);const pending=f.ctx.managePersonalWebsite(f.id);f.ctx.draft={id:'another'};release({url:'/example',code:'PRIVATECODE',expires:'2028-06-30'});await pending;assert.equal(f.modal.innerHTML,'');
 f.ctx.api=async()=>({url:'/example',code:'<script>',expires:'2028-06-30',revoked:true});await f.ctx.managePersonalWebsite(f.id);assert(!f.modal.innerHTML.includes('<script>'));assert(f.modal.innerHTML.includes('Toegang aanzetten met nieuwe code'));assert(!f.modal.innerHTML.includes('Link en code kopiëren'));
});
test('all export routes offer the website and browser navigation keeps its in-memory context',()=>{
 for(const name of ['quickBookResult','finishExport','exportHistoryPanel']){const start=source.indexOf('function '+name+'(');assert(start>=0);assert(source.slice(start,source.indexOf('\nfunction ',start+1)).includes('personalWebsiteAction('),name);}
 assert(source.split('\n').find(l=>l.startsWith('function bookletDialogContext')).includes('personalWebsiteCurrent'));assert(source.split('\n').find(l=>l.startsWith('function applyBookletDialogContext')).includes('personalWebsiteCurrent'));
});
