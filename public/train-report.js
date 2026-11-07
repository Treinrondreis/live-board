import {reportGroups,reportNumbers,delayClass,defaultReportSource} from './train-report-config.mjs';
const root=document.getElementById('reports');
const dateFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
const timeFormat=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',dateStyle:'short',timeStyle:'short'});
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function picker(label,values,value){const field=el('label',label),select=el('select');for(const v of values){const option=el('option',v);option.value=v;select.append(option);}select.value=value;field.append(select);return{field,select};}
for(const group of reportGroups){
  const section=el('section'),head=el('div',undefined,'section-head'),title=el('div');title.append(el('h2',group.title),el('div',group.direction,'sub'));head.append(title);
  const params=new URLSearchParams(location.search),prefix=group.id+'-';
  const station=picker('Meetstation',group.stations,group.stations.includes(params.get(prefix+'station'))?params.get(prefix+'station'):group.stations[0]);
  const source=picker('Bron',['DB','NDOV'],['DB','NDOV'].includes(params.get(prefix+'source'))?params.get(prefix+'source'):defaultReportSource(group,station.select.value));
  const days=picker('Aantal dagen',['30','60','90'],['30','60','90'].includes(params.get(prefix+'days'))?params.get(prefix+'days'):'30');
  for(const {select} of [station,source,days])select.setAttribute('aria-label',select.parentNode.firstChild.textContent+' · '+group.title+' · '+group.direction);
  const pickers=el('div',undefined,'pickers');pickers.append(station.field,source.field,days.field);head.append(pickers);
  const modeNote=el('p',undefined,'foot');modeNote.hidden=!group.eventModes;
  const status=el('p','Gegevens laden…','status'),matrix=el('div',undefined,'matrix'),detail=el('p',undefined,'detail');status.setAttribute('role','status');detail.setAttribute('aria-live','polite');detail.hidden=true;section.append(head,modeNote,status,matrix,detail);
  if(group.id==='berlin-east')section.append(el('p','G = Berlin Gesundbrunnen, als terugval wanneer voor Berlin Hbf geen bruikbare aankomstmeting beschikbaar is.','foot'));
  if(group.id==='swiss')section.append(el('p','15 mei t/m 9 juli 2027: 108 → 1074 en 106 → 1072.','foot'));
  if(group.note)section.append(el('p',group.note,'foot'));
  root.append(section);let controller;
  async function load(save=false){
    controller?.abort();controller=new AbortController();const request=controller;
    const anchorTop=head.getBoundingClientRect().top,initialScroll=window.scrollY,horizontalScroll=matrix.scrollLeft;
    // Keep the old table's layout while loading; removing it collapses the page
    // and clamps scrollY, especially for the last groups near the page bottom.
    matrix.style.visibility='hidden';matrix.inert=true;matrix.setAttribute('aria-busy','true');detail.hidden=true;status.className='status';status.textContent='Gegevens laden…';
    if(group.eventModes)modeNote.textContent=(group.eventModes[station.select.value]==='departure'?'Vertrekmetingen':'Aankomstmetingen')+' bij '+station.select.value+'.';
    const query=new URLSearchParams({group:group.id,station:station.select.value,source:source.select.value,days:days.select.value});
    if(save){const url=new URL(location.href);for(const key of ['station','source','days'])url.searchParams.set(prefix+key,query.get(key));history.replaceState(null,'',url);}
    const timeout=setTimeout(()=>request.abort(),20000);
    try{
      const response=await fetch('/api/treinrapport?'+query,{signal:request.signal});if(!response.ok)throw Error('Gegevens konden niet worden geladen.');const data=await response.json();if(request!==controller)return;
      const table=el('table'),caption=el('caption',group.direction+' · '+data.station+' · '+data.source);caption.hidden=true;table.append(caption);
      const thead=el('thead'),hr=el('tr');hr.append(el('th','Datum'));const numbers=data.rows.map(r=>reportNumbers(group,r.date));
      for(let i=0;i<group.trains.length;i++){const ns=[...new Set(numbers.map(n=>n[i]))];hr.append(el('th',(group.category||'ICE')+' '+ns.join(' / ')));}for(const th of hr.children)th.scope='col';thead.append(hr);table.append(thead);
      const tbody=el('tbody');for(const row of data.rows){const tr=el('tr'),date=el('th',dateFormat.format(new Date(row.date+'T12:00:00Z')));date.scope='row';tr.append(date);
        for(const cell of row.cells){const td=el('td'),text=cell.status==='cancelled'?'✕':cell.status==='not-applicable'?'−':cell.status!=='measured'?'?':(cell.delay>=0?'+':'')+cell.delay;
          const value=el('button',text,'value '+(cell.status==='cancelled'?'cancel':cell.status==='measured'?delayClass(cell.delay):''));value.type='button';
          const info=`${row.date} · ${group.category||'ICE'} ${cell.number} · ${cell.station||data.station} · ${cell.eventMode==='departure'?'vertrek':'aankomst'} · ${cell.source||data.source}: ${cell.status==='cancelled'?'opgeheven bij deze halte':cell.status==='measured'?cell.delay+' minuten, '+(cell.kind==='actual'?'bevestigde realisatie':'bronverwachting'):cell.status==='not-applicable'?'niet van toepassing':'geen meting'}${cell.observedAt?' · laatst gemeten '+timeFormat.format(cell.observedAt):''}`;
          value.title=info;value.setAttribute('aria-label',info);value.addEventListener('click',()=>{detail.textContent=info;detail.hidden=false;});td.append(value);if(cell.eventMode==='departure')td.append(el('span','V','fallback'));
          if(group.id==='berlin-east'&&data.station==='Berlin Hbf'&&cell.station&&/gesundbrunnen/i.test(cell.station))td.append(el('span','G','fallback'));
          if(group.id==='swiss'&&new Set(numbers.map(n=>n[row.cells.indexOf(cell)])).size>1)td.append(el('small',' '+cell.number));tr.append(td);
        }tbody.append(tr);
      }table.append(tbody);const preservePosition=save&&Math.abs(window.scrollY-initialScroll)<2;
      matrix.replaceChildren(table);matrix.style.visibility='';matrix.inert=false;matrix.scrollLeft=horizontalScroll;
      const count=data.rows.flatMap(r=>r.cells).filter(c=>c.status!=='unknown').length;status.textContent=`${data.days} dagen · ${data.from} t/m ${data.to} · ${data.source} · ${count} meetpunten${count===0?' — geen metingen voor deze bron/stationcombinatie. Probeer de andere bron.':''}`;
      if(preservePosition)window.scrollBy(0,head.getBoundingClientRect().top-anchorTop);
    }catch(error){if(request!==controller)return;status.className='status error';status.textContent=error.name==='AbortError'?'Laden duurde te lang. Wijzig een selectie om opnieuw te proberen.':'Gegevens konden niet worden geladen. Wijzig een selectie om opnieuw te proberen.';}finally{clearTimeout(timeout);if(request===controller)matrix.removeAttribute('aria-busy');}
  }
  station.select.addEventListener('change',()=>{source.select.value=defaultReportSource(group,station.select.value);load(true);});
  for(const {select} of [source,days])select.addEventListener('change',()=>load(true));load();
}
