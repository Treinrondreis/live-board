// Authenticated KM-trein administration only; no Drive tokens in the browser.
(()=>{
 const panel=document.querySelector('[data-admin="photo-archive"]');if(!panel)return;
 let timer,busy=false;
 const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
 async function api(action,data){const r=await fetch('/treinhuis/api/'+action,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const value=await r.json();if(!r.ok)throw Error(value.error||'Het fotoarchief is niet bereikbaar.');return value;}
 function draw(s){
  panel.replaceChildren(text('h1','Fotoarchief KMtein26'),text('p','Originele foto’s gaan naar de aparte privémap KMtein26 in Google Drive. Verkleinde voorbeelden blijven op de hosting zodat de app snel blijft. Video’s, documenten en de testeditie worden niet meegenomen.'),text('p',`${s.archived} van ${s.total} originele foto’s gearchiveerd · ${(s.freed/1e9).toFixed(2)} GB vrijgemaakt.`));
  if(s.folderUrl){const a=text('a','Open archiefmap in Drive');a.href=s.folderUrl;a.target='_blank';a.rel='noopener noreferrer';panel.append(a);}
  if(s.lastPhoto){const b=text('button','Controleer overgezet origineel');b.onclick=async()=>{b.disabled=true;try{const result=await api('media?id='+encodeURIComponent(s.lastPhoto));const a=text('a','Open originele foto uit Drive via de app');a.href=result.url;a.target='_blank';a.rel='noopener noreferrer';b.after(a);}catch(e){b.after(text('p',e.message));}finally{b.disabled=false;}};panel.append(b);}
  if(s.error)panel.append(text('p',s.error));
  const status=text('p',s.running?'De overdracht loopt op de server. U kunt dit scherm sluiten.':s.paused?'Overdracht gepauzeerd. Hervatten is veilig.':'Klaar om te starten of verder te gaan.');status.setAttribute('role','status');panel.append(status);
  for(const [label,action,data] of s.running?[['Pauzeren na huidige foto’s','photo-archive-pause',{}]]:[['Eén foto overzetten en controleren','photo-archive-start',{one:true}],['Alle resterende foto’s overzetten','photo-archive-start',{}]]){
   const b=text('button',label);b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;try{draw(await api(action,data));}catch(e){panel.append(text('p',e.message));}finally{busy=false;}};panel.append(b);
  }
  clearTimeout(timer);if(s.running&&!panel.hidden)timer=setTimeout(refresh,5000);
 }
 async function refresh(){if(panel.hidden)return;try{draw(await api('photo-archive'));}catch(e){panel.replaceChildren(text('h1','Fotoarchief KMtein26'),text('p',e.message));}}
 window.addEventListener('hashchange',()=>{clearTimeout(timer);if(location.hash==='#photo-archive')setTimeout(refresh,0);});
 if(location.hash==='#photo-archive')setTimeout(refresh,0);
})();
