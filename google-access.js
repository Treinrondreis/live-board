const $=id=>document.getElementById(id);let state;
async function api(action,data){const r=await fetch('/api/seinhuis-access/'+action,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const j=await r.json();if(!r.ok)throw Error(j.error||'De aanvraag is mislukt.');return j;}
async function run(fn){$('message').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('message').textContent=e.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);if(state&&!state.configured)for(const id of ['google','retry','verify','link-google'])$(id).disabled=true;}}
const date=v=>v?new Date(v).toLocaleString('nl-NL'):'—';
function row(root,text,buttons=[]){const d=document.createElement('div');d.className='item';const label=document.createElement('span');label.textContent=text;d.append(label);for(const [caption,action,data] of buttons){const b=document.createElement('button');b.textContent=caption;b.className='secondary';b.onclick=()=>run(async()=>{await api(action,{...data,...(state.legacyOwner&&!state.authenticated?{code:$('admin-code').value}:{})});$('admin-code').value='';await start();});d.append(b);}$(root).append(d);}
async function overview(){const o=await api('overview');for(const id of ['accounts','devices','sessions','audit'])$(id).replaceChildren();
 for(const a of o.accounts)row('accounts',a.email+' · '+(a.role==='admin'?'Beheerder':a.apps.map(v=>v==='booklets'?'Boekjesmaker':'FloRA').join(' en '))+' · '+(!a.active?'Geblokkeerd':a.linked?'Gekoppeld':'Toegestaan; nog niet gekoppeld'),[[a.active?'Alle toegang blokkeren':'Account toestaan',a.active?'block':'enable',{email:a.email}]]);
 for(const d of o.devices){const location=[d.location?.city,d.location?.country,d.location?.ip].filter(Boolean).join(' · ');row('devices',d.email+' · '+d.label+' · '+({pending:'Wacht op goedkeuring',approved:'Goedgekeurd',revoked:'Ingetrokken'})[d.status]+' · '+(location||'Locatie onbekend')+' · Aangevraagd: '+date(d.created)+' · Laatst actief: '+date(d.lastSeen)+' · '+(d.browser||''),[[d.status==='approved'?'Intrekken':'Goedkeuren',d.status==='approved'?'revoke':'approve',{id:d.id}]]);}
 if(!o.devices.length)row('devices','Nog geen aanvragen.');
 for(const v of o.sessions){const d=o.devices.find(d=>d.id===v.device);row('sessions',v.email+' · '+(d?.label||'Browser')+' · Gestart: '+date(v.created)+' · Laatst actief: '+date(v.lastSeen)+' · Opnieuw aanmelden vóór: '+date(v.expires),[['Sessie afmelden','revoke-session',{id:v.id}]]);}
 if(!o.sessions.length)row('sessions','Geen actieve Google-sessies.');
 const actions={'device-requested':'Browser aangevraagd','admin-linked':'Beheerder gekoppeld','device-approved':'Browser goedgekeurd','device-revoked':'Browser ingetrokken','account-blocked':'Account geblokkeerd','account-enabled':'Account toegestaan','session-revoked':'Sessie afgemeld'};
 for(const a of o.audit)row('audit',date(a.at)+' · '+(actions[a.action]||a.action)+' · '+a.actor+' · '+a.detail);
}
async function start(){state=await api('status');for(const id of ['login','pending','ready','link','admin'])$(id).hidden=true;
 $('logout').hidden=!state.authenticated&&!state.legacyOwner;
 if(!state.configured)$('message').textContent='Google-login wordt nog ingericht. De bestaande beheerlogin blijft beschikbaar.';
 if(state.authenticated){$('ready').hidden=false;$('identity').textContent='Ingelogd als '+state.identity;}
 else if(state.device){$('pending').hidden=false;$('pending-title').textContent=state.device.status==='revoked'?'Toegang ingetrokken':state.device.status==='approved'?'Browser goedgekeurd':'Wachten op goedkeuring';$('pending-text').textContent=state.device.email+' · '+state.device.label+'. '+(state.device.status==='revoked'?'Een beheerder moet deze browser opnieuw goedkeuren.':state.device.status==='approved'?'Meld opnieuw aan via Google als je eerdere bevestiging is verlopen.':'Laat een beheerder deze aanvraag goedkeuren.');$('continue').hidden=state.device.status==='revoked';}
 else $('login').hidden=false;
 $('google').disabled=!state.configured;
 if(state.legacyOwner&&!state.authenticated)$('link').hidden=false;
 if(state.isAdmin){$('admin').hidden=false;$('code-label').hidden=state.authenticated;$('verify').hidden=!state.authenticated;$('verification-hint').textContent=state.authenticated?'Voor beheeracties moet je Google-bevestiging minder dan 10 minuten oud zijn.':'Bevestig iedere beheeractie met een verse Authenticator-code.';await overview();}
}
async function google(action='start'){const j=await api(action,{label:$('label').value||'Mijn browser',...(action==='link'?{code:$('link-code').value}:{})});location.assign(j.url);}
for(const id of ['google','retry','verify'])$(id).onclick=()=>run(()=>google());
 $('link-google').onclick=()=>run(()=>google('link'));
 $('refresh').onclick=()=>run(start);
 $('continue').onclick=()=>run(async()=>{await api('continue',{});await start();});
 $('logout').onclick=()=>run(async()=>{const r=await fetch('/api/admin-security/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Uitloggen mislukt.');location.assign('/seinhuis');});
run(start);
