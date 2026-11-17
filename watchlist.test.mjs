import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatchlist, registerNumbers} from './watchlist.mjs';
import {cleanupSummaries as cleanupSummaries2} from './summaries-cleanup.mjs';

const w = createWatchlist({extraNumbers: () => ['9876']});
const t = (category, number, station, origin, destination, country = '') => ({category, number, station, origin, destination, country});

test('volglijst bewaart de gevraagde treinen', () => {
  const keep = [
    t('ICE', '123', 'Frankfurt(Main)Hbf', 'Amsterdam Centraal', 'Frankfurt(Main)Hbf'),
    t('ICE', '15', 'Köln Hbf', 'Brussel-Zuid', 'Frankfurt(Main)Hbf'),
    t('ICE', '373', 'Offenburg', 'Frankfurt(Main)Hbf', 'Chur'),
    t('ICE', '91', 'Nürnberg Hbf', 'Hamburg-Altona', 'Wien Hbf'),
    t('ICE', '513', 'Köln Hbf', 'Dortmund Hbf', 'München Hbf'),
    t('ICE', '600', 'Frankfurt(Main)Hbf', 'München Hbf', 'Düsseldorf Hbf'),
    t('RJ', '63', 'Linz Hbf', 'München Hbf', 'Budapest-Keleti'),
    t('EC', '7', 'Basel SBB', 'Hamburg', 'Interlaken Ost'),
    t('NJ', '40421', 'Wien Hbf', 'Amsterdam Centraal', 'Wien Hbf'),
    t('EST', '9314', 'Bruxelles-Midi', 'Paris Nord', 'Amsterdam Centraal'),
    t('AVE', '3171', 'Figueres Vilafant', 'Barcelona Sants', 'Marseille'),
    t('TGV', '5110', 'Lyon Part-Dieu', 'Lille Europe', 'Marseille'),
    t('TGV', '6201', 'Valence TGV', 'Paris Gare de Lyon', 'Montpellier Sud de France'),
    t('TER', '76501', 'Montpellier Saint-Roch', 'Avignon Centre', 'Narbonne'),
    t('IC', '3611', 'Limoges Bénédictins', 'Paris Austerlitz', 'Toulouse Matabiau'),
    t('IC', '3611', 'Brive-la-Gaillarde', 'Paris Austerlitz', 'Brive-la-Gaillarde'),
    t('TER', '871234', 'Cahors', 'Brive-la-Gaillarde', 'Cahors'),
    t('TER', '871999', 'Montauban Ville Bourbon', 'Cahors', 'Toulouse Matabiau'),
    t('TER', '76700', 'Collioure', 'Narbonne', 'Cerbère'),
    t('IC', '15950', 'Langogne', 'Nîmes Centre', 'Clermont-Ferrand'),
    t('IC', '5970', 'Nevers', 'Clermont-Ferrand', 'Paris Bercy'),
    t('', '1Y45', 'Aviemore', 'Edinburgh', 'Inverness'),
    t('', '1Y40', 'Crianlarich', 'Glasgow Queen Street', 'Mallaig'),
    t('', '1E10', 'Berwick-upon-Tweed', 'Edinburgh', 'Newcastle'),
    t('', '1E99', 'Carlisle', 'Glasgow Central', 'Newcastle'),
    t('R', '603', 'Myrdal', 'Oslo S', 'Bergen stasjon'.replace('Bergen stasjon','Voss')),
    t('Regional', '61', 'Myrdal', 'Bergen', 'Voss'),
    t('IC', '94', 'Kiruna C', 'Luleå C', 'Narvik'),
    t('Nattåg', '92', 'Boden C', 'Stockholm C', 'Luleå C'),
    t('F', '475', 'Mosjøen', 'Trondheim S', 'Bodø'),
    t('IC', '9876', 'Ergens', 'A', 'B')
  ];
  for (const e of keep) assert.ok(w.includes(e), JSON.stringify(e));
});

test('volglijst laat gewone binnenlandse treinen weg', () => {
  const skip = [
    t('ICE', '1001', 'Berlin Hbf', 'Berlin Hbf', 'Hamburg Hbf'),
    t('ICE', '700', 'Fulda', 'Hamburg Hbf', 'München Hbf'),
    t('IC', '3500', 'Utrecht Centraal', 'Den Haag Centraal', 'Venlo'),
    t('RE', '4931', 'Utrecht Centraal', 'Almere Centrum', 'Utrecht Centraal'),
    t('L', '1234', 'Gent-Sint-Pieters', 'Gent', 'Brugge'),
    t('TGV', '6100', 'Lyon Part-Dieu', 'Paris Gare de Lyon', 'Marseille'),
    t('TER', '860000', 'Limoges Bénédictins', 'Poitiers', 'Limoges Bénédictins'),
    t('TER', '871000', 'Bordeaux Saint-Jean', 'Bordeaux Saint-Jean', 'Brive-la-Gaillarde'),
    t('RENFE', 'C1', 'Madrid Atocha', 'Madrid', 'Alcalá'),
    t('Regional', '200', 'Göteborg C', 'Göteborg C', 'Borås'),
    t('R', '600', 'Gardermoen', 'Oslo S', 'Lillehammer')
  ];
  for (const e of skip) assert.equal(w.includes(e), false, JSON.stringify(e));
});

test('treinnummers uit het reisschemaregister worden ververst', async () => {
  let now = 0, calls = 0;
  const register = {summary: async () => { calls++; return {available: true, legs: [{train_number: 'ICE 145'}, {train_number: '0421'}, {train_number: ''}]}; }};
  const numbers = registerNumbers({register, clock: () => now, ttl: 1000});
  assert.deepEqual(numbers(), []);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(numbers().sort(), ['145', '421']);
  now = 500; numbers(); assert.equal(calls, 1);
  now = 2000; numbers(); assert.equal(calls, 2);
});

test('onbereikbaar register houdt de oude lijst', async () => {
  let now = 0, up = true;
  const register = {summary: async () => up ? {available: true, legs: [{train_number: '145'}]} : {available: false, legs: []}};
  const numbers = registerNumbers({register, clock: () => now, ttl: 10});
  numbers(); await new Promise(r => setImmediate(r));
  up = false; now = 100; numbers(); await new Promise(r => setImmediate(r));
  assert.deepEqual(numbers(), ['145']);
});

test('samenvattingen: filter en opruiming houden alleen volglijsttreinen', async () => {
  const {DatabaseSync} = await import('node:sqlite');
  const {initAnalytics, recordStopSummaries, setSummaryFilter, analyticsQuery} = await import('./train-analytics.mjs');
  const {cleanupSummaries} = await import('./summaries-cleanup.mjs');
  await initAnalytics({sqlite: new DatabaseSync(':memory:')});
  const base = {date: '2026-11-10', source: 'DB', mode: 'arrival', planned: 1, observedAt: 2, realtime: true, delay: 5, cancelled: false};
  const ice = {...base, category: 'ICE', number: '123', station: 'Frankfurt(Main)Hbf', origin: 'Amsterdam Centraal', destination: 'Frankfurt(Main)Hbf'};
  const local = {...base, category: 'RE', number: '4931', station: 'Utrecht Centraal', origin: 'Almere Centrum', destination: 'Utrecht Centraal'};
  await recordStopSummaries([ice, local]);
  const count = async () => Number((await analyticsQuery('SELECT COUNT(*) AS n FROM train_stop_summaries'))[0].n);
  assert.equal(await count(), 2);
  const report = await cleanupSummaries({q: analyticsQuery, includes: w.includes, dryRun: true, pause: 0, log: () => {}});
  assert.deepEqual([report.keep, report.removed, await count()], [1, 1, 2]);
  await cleanupSummaries({q: analyticsQuery, includes: w.includes, dryRun: false, pause: 0, log: () => {}});
  assert.equal(await count(), 1);
  setSummaryFilter(w.includes);
  await recordStopSummaries([{...local, date: '2026-11-11'}, {...ice, date: '2026-11-11'}]);
  setSummaryFilter(null);
  assert.equal(await count(), 2);
});

test('opruiming gaat door na een tijdelijke databasefout', async () => {
  let fails = 2; const deleted = [];
  const rows = [{summary_key: 'a', category: 'RE', train_number: '1', station: 'X', payload: '{}'}];
  const q = async (sql, args) => {
    if (fails-- > 0) throw Error('timeout exceeded when trying to connect');
    if (sql.startsWith('SELECT')) return args[0] === '' ? rows : [];
    deleted.push(...args); return [];
  };
  const r = await cleanupSummaries2({q, includes: () => false, dryRun: false, pause: 0, retryWait: 1, log: () => {}});
  assert.deepEqual([r.removed, deleted], [1, ['a']]);
});
