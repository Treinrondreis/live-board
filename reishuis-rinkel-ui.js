export function createIncomingCalls({node,open,isEditing,onDenied,bookings=()=>[],link=async()=>{}}){
 const root=document.getElementById('incoming-call'),anchor=document.getElementById('rows'),status=document.getElementById('rinkel-state');let cursor,timer,generation=0,noticeTimers=[];
 const home=()=>{if(anchor.isConnected)anchor.before(root);};
 document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',home));
 function clear(){generation++;clearTimeout(timer);for(const t of noticeTimers)clearTimeout(t);noticeTimers=[];root.replaceChildren();root.hidden=true;status.hidden=true;status.textContent='';home();}
 async function poll(seq){
  let delay=3000;
  try{
   if(document.hidden){delay=5000;return;}
   const r=await fetch('/seinhuis/reishuis/api/rinkel?'+new URLSearchParams(cursor?{cursor}:{}),{cache:'no-store'});
   if(r.status===401||r.status===403){clear();onDenied();return;}
   if(!r.ok){status.hidden=false;status.textContent='Rinkel: verbinding tijdelijk niet beschikbaar.';delay=10000;return;}const data=await r.json();if(seq!==generation)return;
   cursor=data.cursor||cursor;if(!data.enabled){status.hidden=true;delay=60000;return;}
   status.hidden=false;status.textContent=data.ready?'Rinkel: nummerherkenning actief':data.failed?'Rinkel: nummerherkenning tijdelijk niet beschikbaar.':'Rinkel: nummerherkenning voorbereiden…';
   if(!data.ready)return;
   const events=(data.events||[]).filter(e=>Date.now()-e.at<1800000);if(!events.length)return;
   for(const t of noticeTimers)clearTimeout(t);noticeTimers=[];root.replaceChildren();root.hidden=false;root.append(node('strong',data.recent?'Recente oproep'+(events.length===1?'':'en'):events.length===1?'Inkomende oproep':'Inkomende oproepen'));
   const active=document.querySelector('dialog[open]');if(active)active.prepend(root);else home();
   for(const event of events){
    const section=node('div',undefined,'incoming-event'),matches=event.matches||[];
    section.append(node('p',matches.length===0?(event.anonymous?'Anonieme oproep: geen dossierherkenning mogelijk.':'Geen passend dossier gevonden voor dit nummer.'):matches.length===1?'Eén passend dossier.':'Meerdere dossiers bij dit telefoonnummer. Kies de juiste boeking.'));
    for(const b of matches){const button=node('button',b.index+' · '+b.name+(b.departure?' · '+b.departure:''));button.type='button';button.onclick=()=>{root.hidden=true;open(b.id);};section.append(button);}root.append(section);
    const chooser=node('details'),summary=node('summary','Gesprek aan dossier koppelen');chooser.append(summary);
    const search=node('input');search.placeholder='Zoek boekingsnummer of klantnaam';search.setAttribute('aria-label','Dossier zoeken voor oproep');
    const select=node('select');select.setAttribute('aria-label','Dossier voor oproep');
    const fill=()=>{const q=search.value.toLocaleLowerCase('nl-NL');select.replaceChildren(new Option('Kies bewust een dossier…',''));for(const b of bookings().filter(b=>(b.index+' '+b.name).toLocaleLowerCase('nl-NL').includes(q)).slice(0,100))select.append(new Option(b.index+' · '+b.name,b.id));};search.oninput=fill;fill();
    const label=node('label'),remember=node('input');remember.type='checkbox';remember.disabled=event.anonymous;label.append(remember,document.createTextNode(' Dit nummer ook onthouden voor volgende oproepen'+(event.lastFour?' (…'+event.lastFour+')':'')));
    const save=node('button','Gesprek koppelen');save.type='button';const result=node('p');save.onclick=async()=>{if(!select.value){result.textContent='Kies eerst het juiste dossier.';return;}if(!confirm('Dit gesprek koppelen aan '+select.selectedOptions[0].text+'?'+(remember.checked?' Dit nummer wordt voortaan ook herkend.':'')))return;save.disabled=true;try{await link({action:'rinkel-link',call:event.id,booking:select.value,remember:remember.checked,confirm:true});result.textContent='Gesprek gekoppeld.';}catch{result.textContent='Koppelen mislukt. Herlaad en controleer je keuze.';}finally{save.disabled=false;}};
    chooser.append(search,select,label,save,result);section.append(chooser);
    noticeTimers.push(setTimeout(()=>{section.remove();if(!root.querySelector('.incoming-event')){root.hidden=true;root.replaceChildren();}},Math.max(0,1800000-(Date.now()-event.at))));
   }
   const dismiss=node('button','Melding sluiten');dismiss.type='button';dismiss.onclick=()=>{root.hidden=true;root.replaceChildren();};root.append(dismiss);
   if(!data.recent&&events.length===1&&events[0].matches?.length===1&&!isEditing())open(events[0].matches[0].id);
  }catch{delay=10000;}
  finally{if(seq===generation)timer=setTimeout(()=>poll(seq),delay);}
 }
 return {clear,start(){clear();cursor=undefined;void poll(generation);}};
}
