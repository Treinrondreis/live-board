import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchlistJourneys} from './watchlist-journeys.mjs';
import {createWatchlist} from './watchlist.mjs';
import {applyJourneySnapshot} from './journeys.mjs';

const w = createWatchlist();
const at = Date.UTC(2026, 10, 18, 8);
const tgv = (station, mode, planned, extra = {}) => ({number: '6201', category: 'TGV', observedAt: station, eventMode: mode, plannedTimestamp: planned,
  from: 'Paris Gare de Lyon', to: 'Montpellier Sud de France', ...extra});

test('volglijsttrein uit SNCF komt in het ritarchief, met spoor en vertraging', async () => {
  const saved = [];
  const rec = createWatchlistJourneys({includes: w.includes, record: async s => saved.push(s), exists: async () => false, clock: () => at});
  const n = await rec([
    tgv('Valence TGV', 'departure', at + 3600e3, {expectedTimestamp: at + 3900e3, hasRealtime: true, plannedTrack: 'B', currentTrack: 'C'}),
    tgv('Montpellier Sud de France', 'arrival', at + 7200e3),
    {number: '6100', category: 'TGV', observedAt: 'Lyon Part-Dieu', eventMode: 'departure', plannedTimestamp: at, from: 'Paris Gare de Lyon', to: 'Marseille'}
  ], 'SNCF', at);
  assert.equal(n, 1);
  const s = saved[0];
  assert.equal(s.trainNumber, '6201');
  assert.equal(s.archiveSource, 'WL-SNCF');
  assert.equal(s.serviceDate, '2026-11-18');
  assert.equal(s.stops.length, 2);
  const state = applyJourneySnapshot(null, s, at);
  const valence = state.stops.find(x => x.station === 'Valence TGV');
  assert.equal(valence.departure.planning.platform, 'B');
  assert.equal(valence.departure.realtime.platform, 'C');
  assert.equal(valence.departure.realtime.expectedTime, at + 3900e3);
  assert.deepEqual(state.stops.map(x => x.station), ['Valence TGV', 'Montpellier Sud de France']);
});

test('ongewijzigde metingen worden niet opnieuw opgeslagen', async () => {
  const saved = [];
  const rec = createWatchlistJourneys({includes: w.includes, record: async s => saved.push(s), exists: async () => false, clock: () => at});
  const rows = [tgv('Valence TGV', 'departure', at + 3600e3, {expectedTimestamp: at + 3600e3, hasRealtime: true})];
  await rec(rows, 'SNCF', at);
  await rec(rows, 'SNCF', at + 60000);
  assert.equal(saved.length, 1);
  await rec([tgv('Valence TGV', 'departure', at + 3600e3, {expectedTimestamp: at + 4200e3, hasRealtime: true})], 'SNCF', at + 120000);
  assert.equal(saved.length, 2);
});

test('nachttrein blijft op dezelfde dienstdag', async () => {
  const saved = [];
  const rec = createWatchlistJourneys({includes: w.includes, record: async s => saved.push(s), exists: async () => false, clock: () => at});
  const nj = (station, mode, planned) => ({number: '40421', category: 'NJ', observedAt: station, eventMode: mode, plannedTimestamp: planned, from: 'Amsterdam Centraal', to: 'Wien Hbf'});
  const evening = Date.UTC(2026, 10, 18, 19), morning = Date.UTC(2026, 10, 19, 8);
  await rec([nj('Köln Hbf', 'departure', evening)], 'DB', evening);
  await rec([nj('Wien Hbf', 'arrival', morning)], 'DB', morning);
  assert.deepEqual(saved.map(s => s.serviceDate), ['2026-11-18', '2026-11-18']);
});

test('geen dubbele rit als NDOV/OJP/NMBS hem al heeft, en volledige bronnen worden overgeslagen', async () => {
  const saved = [];
  const rec = createWatchlistJourneys({includes: w.includes, record: async s => saved.push(s), exists: async n => n === '123', clock: () => at});
  const ice = {number: '123', category: 'ICE', observedAt: 'Frankfurt(Main)Hbf', eventMode: 'arrival', plannedTimestamp: at, from: 'Amsterdam Centraal', to: 'Frankfurt(Main)Hbf'};
  assert.equal(await rec([ice], 'DB', at), 0);
  assert.equal(await rec([{...ice, number: '515', from: 'Dortmund Hbf', to: 'München Hbf'}], 'NDOV', at), 0);
  assert.equal(await rec([{...ice, number: '515', from: 'Dortmund Hbf', to: 'München Hbf'}], 'DB', at), 1);
  assert.equal(saved[0].trainNumber, '515');
});
