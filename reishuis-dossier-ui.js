import {paymentSummary,paymentLabels} from './reishuis-payments.mjs';
const personal=[['firstName','Voornaam'],['lastName','Achternaam'],['address','Adres'],['postalCode','Postcode'],['city','Plaats'],['country','Land'],['email','E-mail'],['phone','Telefoon'],['emergencyName','Naam noodcontact'],['emergencyPhone','Telefoon noodcontact']];
const todoStatuses=[['pending','Te doen'],['doing','Mee bezig'],['caution','Opletten'],['done','Gedaan']];
const lineTypes=[['product','Product'],['option','Optie'],['discount','Korting'],['margin','Marge']];
const money=v=>typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(v):'Onbekend';
const numeric=v=>typeof v==='number'&&Number.isFinite(v);
export function invoiceTotals(lines){
 let total=0,cost=0,missing=0,invalid=0,archived=0;
 for(const l of lines){if(l.sourceRemoved){archived++;continue;}if(numeric(l.quantity)&&numeric(l.price))total+=Math.round(l.quantity*l.price*100);else invalid++;if(numeric(l.quantity)&&numeric(l.costs))cost+=Math.round(l.quantity*l.costs*100);else missing++;}
 return {total:total/100,cost:cost/100,missing,invalid,archived};
}
export function createDossierUI({node,change,request,run}){
 let generation=0;
 return {clear(){generation++;},async open(id,root){
  const seq=++generation,loading=node('p','Dossier laden…');root.replaceChildren(loading);let record,conflicted=false;
  const current=()=>seq===generation&&root.isConnected;
  try{record=await request(id);}catch(e){if(current())loading.textContent=e.message;return;}if(!current())return;
  const d=record.dossier,notice=node('p',undefined,'muted'),tabs=node('div',undefined,'dossier-tabs'),panels=node('div'),feedback=node('p','', 'dossier-feedback');feedback.setAttribute('role','status');
  const updateNotice=()=>{notice.textContent='Alle wijzigingen worden alleen in Reishuis opgeslagen. Sanity blijft ongewijzigd. · Gelezen '+new Date(record.syncedAt).toLocaleString('nl-NL',{timeZone:'Europe/Amsterdam'})+(record.syncFailed?' · bijwerken mislukt; laatst bekende bron':record.stale?' · laatst bekende bron; heropen voor de bijgewerkte versie':'');};updateNotice();
  root.replaceChildren(notice,tabs,feedback,panels);
  const field=(form,key,label,value,{type='text',options,max=500}={})=>{
   const l=node('label',label),input=node(options?'select':type==='textarea'?'textarea':'input');input.name=key;
   if(options)for(const [v,t] of options)input.append(new Option(t,v));else if(type!=='textarea')input.type=type;
   if(type==='checkbox')input.checked=value===true;else input.value=value??'';
   if(type==='number'){input.step='any';input.min=key==='quantity'?'0':key==='vatRate'?'0':'-10000000';input.max=key==='quantity'?'10000':key==='vatRate'?'100':'10000000';}else if(!options&&type!=='checkbox')input.maxLength=max;
   l.append(input);form.append(l);return input;
  };
  const values=form=>Object.fromEntries([...form.elements].filter(e=>e.name).map(e=>[e.name,e.type==='checkbox'?e.checked:e.type==='number'?(e.value===''?null:Number(e.value)):e.value]));
  const save=(form,section,item,add=false,after)=>{
   const submit=node('button','Opslaan in Reishuis');submit.type='submit';form.append(submit);
   form.onsubmit=e=>{e.preventDefault();run(async()=>{
    submit.disabled=true;feedback.textContent='Opslaan…';
    try{if(conflicted)throw Error('Heropen het dossier om nieuwe gegevens te controleren.');const saved=await change({action:'dossier',booking:id,section,item,add,values:values(form),sourceVersion:record.sourceVersion},record.revision);const next=await request(id);if(!current())return;if(next.revision!==saved.revision||next.sourceVersion!==record.sourceVersion){conflicted=true;throw Error('Gegevens zijn tussentijds bijgewerkt. Heropen het dossier.');}record=next;updateNotice();feedback.textContent='Opgeslagen in Reishuis. Sanity is ongewijzigd.';after?.(next.dossier);}
    catch(error){if(current())feedback.textContent=error.message+' Je invoer blijft staan.';}
    finally{if(current())submit.disabled=false;}
   });};
  };
  function panel(label,key){const button=node('button',label),section=node('section',undefined,'dossier-section');button.type='button';button.setAttribute('aria-pressed',panels.children.length?'false':'true');section.hidden=!!panels.children.length;button.onclick=()=>{for(const p of panels.children)p.hidden=p!==section;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b===button));};section.id='dossier-'+key;section.append(node('h3',label));tabs.append(button);panels.append(section);return section;}
  const personPanel=panel('Persoonsgegevens','personal'),personForm=node('form',undefined,'dossier-grid');
  for(const [key,label] of personal)field(personForm,key,label,d.personal[key],{type:key==='email'?'email':'text'});save(personForm,'personal');personPanel.append(personForm);
  personPanel.append(node('h4','Reizigers'));
  if(!d.passengers.length)personPanel.append(node('p','Geen reizigersgegevens in de bron.'));
  for(const p of d.passengers){const row=node('div',undefined,'dossier-passenger');row.append(node('strong',[p.firstName,p.lastName].filter(Boolean).join(' ')||p.name||'Naam ontbreekt'));for(const [k,label] of [['dateOfBirth','Geboortedatum'],['type','Reizigerstype'],['gender','Geslacht'],['nationality','Nationaliteit'],['countryOfResidence','Woonland'],['station','Vertrekstation']])if(p[k])row.append(node('p',label+': '+p[k]));personPanel.append(row);}
  const todoPanel=panel('Todo’s en aantekeningen','todos'),notesForm=node('form');
  field(notesForm,'notes','Interne aantekeningen',d.notes,{type:'textarea',max:10000});field(notesForm,'comment','Opmerkingen van klant',d.comment,{type:'textarea',max:10000});save(notesForm,'notes');todoPanel.append(notesForm);
  const todoList=node('div');todoPanel.append(todoList);
  const todoForm=(row={},add=false)=>{
   const wrapper=node('details',undefined,'dossier-item');wrapper.open=add;const summary=node('summary',row.title||'Nieuwe todo');wrapper.append(summary);const form=node('form',undefined,'dossier-grid');
   if(row.sourceRemoved)form.append(node('p','Niet meer aanwezig in de bron. Je eigen versie is bewaard.','muted'));
   field(form,'title','Titel todo',row.title);field(form,'status','Todo-status',row.status||'pending',{options:todoStatuses});field(form,'description','Todo-aantekening',row.description,{type:'textarea',max:10000});field(form,'quantity','Aantal todo',row.quantity??1,{type:'number'});
   for(const [k,l] of [['startDate','Datum / check-in'],['endDate','Check-out'],['bookableFrom','Boekbaar vanaf'],['deadline','Deadline']])field(form,k,l,(row[k]||'').slice(0,10),{type:'date'});
   field(form,'tag','Type todo',row.tag);field(form,'supplierBookingNumber','Bevestigingsnummer',row.supplierBookingNumber);
   save(form,'todo',row.id,add,next=>{if(add){wrapper.remove();todoForm(next.todos.at(-1));}else summary.textContent=form.elements.title.value||'Todo';});wrapper.append(form);todoList.append(wrapper);return wrapper;
  };
  for(const row of d.todos)todoForm(row);if(!d.todos.length)todoList.append(node('p','Nog geen todo’s.'));
  const addTodo=node('button','Todo toevoegen');addTodo.type='button';addTodo.onclick=()=>todoForm({},true).scrollIntoView({block:'nearest'});todoPanel.append(addTodo);
  const finance=panel('Factuur en financiën','finance'),totals=node('div',undefined,'finance-totals');
  const updateTotals=data=>{const {total,cost,missing,invalid,archived}=invoiceTotals(data.lines);totals.replaceChildren(node('p','Berekende reissom: '+money(total)+(invalid?' · '+invalid+' onvolledige regel(s)':'')),node('p','Bekende werkelijke kosten: '+money(cost)+(missing?' · werkelijke prijs ontbreekt op '+missing+' regel(s)':' · compleet')),node('p','Oorspronkelijke reissom bij boeken: '+money(data.initialPrice)));if(archived)totals.append(node('p',archived+' bewaarde vervallen regel(s) niet meegeteld.'));};updateTotals(d);
  finance.append(node('p',[d.invoiceTitle||'Factuur',d.invoiceSubtitle,d.vendorName].filter(Boolean).join(' · ')),totals,node('p','Bedragen per stuk, in euro. Regeltotalen zijn aantal × prijs. Betaalverzoeken blijven alleen-lezen.','muted'));
  const lineList=node('div');finance.append(lineList);
  const lineForm=(row={},add=false)=>{
   const wrapper=node('details',undefined,'dossier-item'),summary=node('summary',(row.title||'Nieuwe factuurregel')+' · '+money(numeric(row.quantity)&&numeric(row.price)?row.quantity*row.price:null));wrapper.open=add;wrapper.append(summary);const form=node('form',undefined,'dossier-grid');
   if(row.sourceRemoved)form.append(node('p','Niet meer aanwezig in de bron. Je eigen versie is bewaard; deze regel telt niet mee in de totalen.','muted'));
   field(form,'title','Titel factuurregel',row.title);field(form,'subTitle','Omschrijving factuurregel',row.subTitle);field(form,'quantity','Aantal',row.quantity??1,{type:'number'});field(form,'price','Berekende prijs per stuk',row.price,{type:'number'});field(form,'costs','Werkelijke prijs per stuk',row.costs,{type:'number'});field(form,'type','Type factuurregel',row.type||'product',{options:lineTypes});field(form,'visible','Zichtbaar op factuur',row.visible!==false,{type:'checkbox'});field(form,'date','Datum factuurregel',(row.date||'').slice(0,10),{type:'date'});field(form,'vatRate','Btw-percentage',row.vatRate,{type:'number'});
   save(form,'line',row.id,add,next=>{updateTotals(next);if(add){wrapper.remove();lineForm(next.lines.at(-1));}else{const v=values(form);summary.textContent=(v.title||'Factuurregel')+' · '+money(v.quantity*v.price);}});wrapper.append(form);lineList.append(wrapper);return wrapper;
  };
  for(const row of d.lines)lineForm(row);if(!d.lines.length)lineList.append(node('p','Geen factuurregels in de bron.'));
  const addLine=node('button','Factuurregel toevoegen');addLine.type='button';addLine.onclick=()=>lineForm({},true).scrollIntoView({block:'nearest'});finance.append(addLine,node('h4','Betaalverzoeken'));if(!d.payments?.length)finance.append(node('p','Geen betaalverzoeken in de bron.'));for(const p of d.payments||[]){const row=node('div',undefined,'dossier-passenger'),summary=paymentSummary([p]);row.append(node('strong',money(p.price)+' · '+(['cancelled','canceled','void'].includes(p.status)?'Geannuleerd':paymentLabels[summary.status])),node('p','Vervaldatum: '+(p.dateDue?.slice(0,10)||'Ontbreekt')+' · Ontvangen: '+money(summary.paid)+' · Open: '+money(summary.outstanding)));for(const f of p.fulfillments)row.append(node('p','Ontvangst '+(f.date?.slice(0,10)||'zonder datum')+' · '+money(f.amount)));finance.append(row);}
 }};
}
