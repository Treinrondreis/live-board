export const reportGroups = [
  {id:'berlin-west',title:'ICE Amsterdam – Berlijn',direction:'Richting Amsterdam',trains:['240','146','144','140'],stations:['Amsterdam Centraal','Amersfoort Centraal','Deventer','Hengelo','Bad Bentheim']},
  {id:'berlin-east',title:'ICE Amsterdam – Berlijn',direction:'Richting Berlijn',trains:['141','145','147','241'],stations:['Berlin Hbf','Berlin Gesundbrunnen','Hannover Hbf','Hamburg Harburg','Osnabrück Hbf','Bad Bentheim']},
  {id:'frankfurt-east',title:'ICE Amsterdam – Frankfurt (– Mannheim)',direction:'Richting Duitsland',trains:['121','225','123','125','127','129','221'],stations:['Frankfurt Flughafen','Mannheim Hbf','Köln Hbf','Köln Messe/Deutz','Düsseldorf Hbf','Stuttgart Hbf','München Hbf']},
  {id:'frankfurt-west',title:'ICE Amsterdam – Frankfurt (– Mannheim)',direction:'Richting Amsterdam',trains:['220','128','126','124','122','224','120'],stations:['Amsterdam Centraal','Utrecht Centraal','Arnhem Centraal','Düsseldorf Hbf']},
  {id:'nightjet-east',title:'NJ 40421 Amsterdam – Wien',direction:'Richting Wien',trains:['40421'],stations:['Wien Hbf'],category:'NJ'},
  {id:'nightjet-west',title:'NJ 40490 Wien – Amsterdam',direction:'Richting Amsterdam',trains:['40490'],stations:['Amsterdam Centraal','Utrecht Centraal','Arnhem Centraal'],category:'NJ'},
  {id:'swiss',title:'ICE Zwitserland – Keulen',direction:'Richting Keulen',trains:['108','106'],stations:['Köln Hbf','Düsseldorf Hbf','Frankfurt Flughafen']}
];
export const stationAliases = {
  'Amsterdam Centraal':['Amsterdam Centraal','Amsterdam C'],
  'Amersfoort Centraal':['Amersfoort Centraal','Amersfoort'],
  'Utrecht Centraal':['Utrecht Centraal','Utrecht C'],
  'Arnhem Centraal':['Arnhem Centraal','Arnhem'],
  'Frankfurt Flughafen':['Frankfurt(M) Flughafen Fernbf','Frankfurt (M) Flughafen Fernbf','Frankfurt(Main) Flughafen Fernbf','Frankfurt Flughafen Fernbf','Frankfurt Flughafen'],
  'Köln Messe/Deutz':['Köln Messe/Deutz','Köln Messe/Deutz Gl.11-12','Köln Messe Deutz'],
  'Berlin Gesundbrunnen':['Berlin Gesundbrunnen','Berlin-Gesundbrunnen']
};
export const normalizeStation = value => value.normalize('NFKC').trim().toLowerCase();
export const aliasesFor = station => (stationAliases[station] || [station]).map(normalizeStation);
export function reportNumbers(group,date) {
  return group.id === 'swiss' && date >= '2027-05-15' && date <= '2027-07-09' ? ['1074','1072'] : group.trains;
}
export function delayClass(delay) {
  if (!Number.isFinite(delay)) return '';
  return delay >= 60 ? 'severe' : delay >= 31 ? 'bad' : delay >= 16 ? 'warn' : 'good';
}
