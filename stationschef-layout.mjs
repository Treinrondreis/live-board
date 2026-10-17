import {adminUiNavigation} from './admin-ui-navigation.mjs';

export const stationschefSections=[
 ['overzicht','Overzicht','/stationschef','Instellingen voor treinborden, aansluitingen en perrons.'],
 ['treinbord','Grote treinbord','/stationschef/treinbord','Kies de treinen, bronnen en afwisseling per scherm.'],
 ['borden','Vertrekborden','/stationschef/borden','Beheer stations, filters en de vormgeving van vertrekborden.'],
 ['aansluitingen','Aansluitingen','/stationschef/aansluitingen','Beheer aansluitingen, uitzonderingen en voorwaarden.'],
 ['perrons','Perrons en overstaptijden','/stationschef/perrons','Beheer spoorindeling en uitleg voor overstappen.']
];
export function stationschefShell({head='',content='',current='overzicht',navigation=''}){
 if(!stationschefSections.some(([key])=>key===current))throw Error('Unknown Stationschef view');
 const links=stationschefSections.map(([key,label,url])=>`<a href="${url}"${key===current?' aria-current="page"':''}>${label}</a>`).join('');
 return `<!doctype html><html lang="nl"><head>${head}<link rel="stylesheet" href="/admin-ui/module-colors.css"><link rel="stylesheet" href="/admin-ui/stationschef-workspace.css"><script src="/admin-ui/stationschef-workspace.js" defer></script></head><body class="sc-ui tr-module-stationschef sc-page-${current}"><a class="sc-skip" href="#sc-main">Naar de inhoud</a><header class="sc-mobile"><a href="/stationschef">Stationschef</a><button type="button" class="sc-toggle" aria-controls="sc-sidebar" aria-expanded="false">Menu</button></header><div class="sc-layout"><aside class="sc-sidebar" id="sc-sidebar"><h2>Stationschef<small>Borden en aansluitingen</small></h2><nav aria-label="Menu Stationschef">${links}</nav><div class="sc-external"><a href="/aansluitarchief">Aansluitarchief ↗</a><a href="/dagverslagen">Dagverslagen ↗</a></div><details class="sc-modules"><summary>Andere onderdelen</summary>${navigation}</details><a class="sc-back" href="/seinhuis">← Terug naar Seinhuis</a></aside><main class="sc-main" id="sc-main" tabindex="-1"><div class="sc-breadcrumb"><a href="/seinhuis">Seinhuis</a> / <a href="/stationschef">Stationschef</a></div>${content}</main></div></body></html>`;
}
export async function stationschefPage(req,html,current){
 // Wrap trusted repository templates, retaining all editor controls and scripts.
 const body=/<body[^>]*>/i.exec(html),implicit=/<(?:header|main)\b/i.exec(html);
 const start=body?body.index+body[0].length:implicit?.index;
 if(start==null)throw Error('Stationschef template has no content');
 const head=html.slice(0,body?body.index:start).replace(/<!doctype[^>]*>|<\/?html[^>]*>|<\/?head[^>]*>/gi,'');
 let content=html.slice(start).replace(/<\/body\s*>|<\/html\s*>/gi,'');
 content=content.replace(/<main\b([^>]*)>/i,'<div$1 data-sc-content>').replace(/<\/main\s*>/i,'</div>');
 return stationschefShell({head,content,current,navigation:await adminUiNavigation(req,'stations')});
}
export async function stationschefOverview(req){
 const cards=stationschefSections.slice(1).map(([,title,url,description])=>`<a class="sc-tile" href="${url}"><h2>${title}</h2><p>${description}</p><span>Openen →</span></a>`).join('');
 return stationschefShell({head:'<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Stationschef · Beheer</title><link rel="icon" href="/brand-icons/stationschef.svg">',content:`<h1>Stationschef</h1><p class="sc-intro">Treinborden, aansluitingen en spoorinformatie op één plek.</p><div class="sc-tiles">${cards}</div>`,navigation:await adminUiNavigation(req,'stations')});
}
