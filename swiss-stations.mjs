// StopPlace identifiers verified with OJP LocationInformation, September 2026.
export const swissStations=Object.fromEntries([
  ['geneve','Genève','1008'],['olten','Olten','218'],['winterthur','Winterthur','6000'],['locarno','Locarno','5400'],
  ['visp','Visp','1605'],['chur','Chur','9000'],['basel-sbb','Basel SBB','10'],['zuerich','Zürich HB','3000'],
  ['luzern','Luzern','5000'],['interlaken-ost','Interlaken Ost','7492'],['interlaken-west','Interlaken West','7493'],
  ['bern','Bern','7000'],['spiez','Spiez','7483'],['thun','Thun','7100'],['kandersteg','Kandersteg','7475'],
  ['zermatt','Zermatt','1689'],['taesch','Täsch','1688'],['montreux','Montreux','1300'],['lausanne','Lausanne','1120'],
  ['brig','Brig','1609'],['andermatt','Andermatt','5165'],['goeschenen','Göschenen','5119'],
  ['disentis','Disentis/Mustér','9179'],['filisur','Filisur','9195'],['alp-gruem','Alp Grüm','9357'],
  ['tirano','Tirano','9369'],['lugano','Lugano','5300'],['bellinzona','Bellinzona','5213'],
  ['flueelen','Flüelen','5112'],['schaffhausen','Schaffhausen','3424'],['st-gallen','St. Gallen','6302'],
  ['sargans','Sargans','9411'],['landquart','Landquart','9002'],['st-moritz','St. Moritz','9253']
].map(([key,name,id])=>[key,{name,id:'ch:1:sloid:'+id,country:key==='tirano'?'IT':'CH'}]));
swissStations['interlaken-ost'].boatId='ch:1:sloid:8370';
swissStations['interlaken-west'].boatId='ch:1:sloid:7169';
swissStations.thun.boatId='ch:1:sloid:7150';
swissStations.brig.extraStopIds=['ch:1:sloid:15296'];
swissStations.tirano.notice='Dit bord toont de RhB-treinen in Tirano. Italiaanse treinen richting Milaan zijn niet opgenomen.';
