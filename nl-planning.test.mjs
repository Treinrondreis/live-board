import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseDutchPlan} from './nl-planning.mjs';
const files={
 'delivery.dat':'@100,26102026,12122026,0104,Fixture',
 'footnote.dat':'#1\n'+'1'.repeat(80),
 'stations.dat':'0,DE,00,00,D,0000,,,Voorbeeld buitenland\n1,AH,00,00,NL,0000,,,Arnhem Centraal\n1,ASD,00,00,NL,0000,,,Amsterdam Centraal',
 'timetbls.dat':'#fixture\n%0,99101,0,1,3\n-1,1,3\n&ICE,1,3\n>DE,1000\n+AH,1100,1102\n<ASD,1200'
};
const result=parseDutchPlan(zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)]))),[{code:'AH',name:'Arnhem Centraal'}],Date.UTC(2026,9,27,12));
const j=result.iceJourneys.find(j=>j.serviceDate==='2026-10-27');
assert.equal(j.number,'99101');
assert.equal(j.stops[0].country,'D');
assert.equal(j.stops.at(-1).country,'NL');
assert.ok(j.stops.at(-1).arrival);
assert.equal(j.stops.at(-1).departure,null);
assert.equal(result.rows.some(r=>r.observedAt==='Amsterdam Centraal'),false);
console.log('IFF full ICE journey includes foreign entry and Dutch terminal arrival without changing subscribed departure rows');
