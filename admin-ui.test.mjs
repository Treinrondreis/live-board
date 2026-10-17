import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createAdminUiPreview} from './scripts/preview-admin-ui.mjs';

const css=await readFile(new URL('./public/admin-ui/tokens.css',import.meta.url),'utf8');
const colors=Object.fromEntries([...css.matchAll(/--tr-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map(m=>[m[1],m[2]]));
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('readable normal text, badges and white text across the header gradient',()=>{
  const pairs=[['text','surface'],['muted','surface'],['muted','background'],['muted','surface-soft'],['blue','surface'],['success','success-bg'],['attention','attention-bg'],['alarm','alarm-bg'],['surface','blue'],['surface','gradient-start'],['surface','gradient-end']];
  for(const [fg,bg] of pairs)assert.ok(contrast(colors[fg],colors[bg])>=4.5,fg+' on '+bg+' must meet 4.5:1');
  assert.ok(contrast('#ffffff','#337453')>=4.5);
  assert.ok(contrast(colors['control-line'],colors.surface)>=3,'input boundaries must meet 3:1');
});
test('preview is read-only and cannot expose files above the specimen directory',async()=>{
  const server=createAdminUiPreview();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const home=await fetch(origin);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/connect-src 'none'/);
    for(const path of ['/..%2f..%2fpackage.json','/%2e%2e%5c%2e%2e%5cpackage.json','/api/state'])assert.equal((await fetch(origin+path)).status,404);
    assert.equal((await fetch(origin,{method:'POST',body:'example'})).status,405);
    assert.equal((await fetch(origin+'/fonts/montserrat-latin.woff2')).headers.get('content-type'),'font/woff2');
  }finally{await new Promise(r=>server.close(r));}
});
