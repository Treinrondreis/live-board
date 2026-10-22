import {adminAuthenticated} from './admin-security.mjs';

// Fixed destinations, rendered using the existing server-side permissions.
const modules=[['stations','Stationschef','/stationschef'],['treinhuis','KM-trein','/treinhuis'],['treinreiziger','Treinreiziger','/seinhuis/treinreiziger'],['booklets','Boekjesmaker','/seinhuis/boekjesmaker/'],['flora','FloRA','/seinhuis/flora/']];
export async function adminUiNavigation(req,current,{authenticate=adminAuthenticated}={}){
  const owner=await authenticate(req),links=['<a href="/seinhuis">Seinhuis</a>'];
  for(const [scope,label,url] of modules)if(owner||await authenticate(req,scope))links.push('<a href="'+url+'"'+(scope===current?' aria-current="page"':'')+'>'+label+'</a>');
  return '<nav class="tr-global-nav" aria-label="Onderdelen">'+links.join('')+'</nav>';
}
