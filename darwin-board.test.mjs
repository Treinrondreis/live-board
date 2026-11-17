import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { initBoardCache } from './board-cache.mjs';
import { initBoardAdmin, applyBoardSettings, defaultBoardSettings, validateBoardSettings } from './board-admin.mjs';
import { setImmediate as settled } from 'node:timers/promises';
import { createDarwinBoards, darwinStations } from './darwin-board.mjs';

test('shares a departure request and preserves the distinction between live and scheduled', async () => {
  let requests = 0;
  const board = createDarwinBoards({
    clock: () => Date.parse('2026-07-01T22:55:00Z'),
    apiKey: () => 'fixture-key',
    fetchBoard: async (url, options) => {
      requests++;
      assert.match(url, /GetDepartureBoard\/YRK\?numRows=30$/);
      assert.equal(options.headers['x-apikey'], 'fixture-key');
      assert.equal(options.redirect, 'error');
      return {ok: true, json: async () => ({crs: 'YRK', trainServices: [
        {serviceID: '1', std: '23:57', etd: '00:03', destination: [{locationName: 'Teststation'}]},
        {rid: '2', std: '23:59', etd: 'Cancelled'},
        {rid: '3', std: '00:01', etd: '00:01', etdSpecified: false},
        {rid: '4', std: '00:03', etd: 'Delayed'},
        {rid: '5', std: '00:04', etd: 'On time'},
      ]})};
    },
  });
  const [a, b] = await Promise.all([board('york'), board('york')]);
  assert.deepEqual(a, b);
  assert.equal(requests, 1);
  assert.equal(a.status, 'starting');
  await settled();
  const ready = await board('york');
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.departures.all.map(r => [r.delay, r.cancelled, r.hasRealtime]),
    [[6, false, true], [null, true, true], [null, false, false], [null, false, true], [0, false, true]]);
  assert.equal(ready.departures.all[3].status, 'Vertraagd');
  assert.equal(JSON.stringify(a).includes('fixture-key'), false);
  assert.equal(await board('unsupported'), null);
});

test('does not continuously retry an unavailable feed', async () => {
  let requests = 0;
  const board = createDarwinBoards({
    apiKey: () => 'fixture-key',
    fetchBoard: async () => { requests++; return {ok: false, status: 403}; },
  });
  assert.equal((await board('inverness')).status, 'starting');
  await settled();
  assert.equal((await board('inverness')).status, 'unavailable');
  assert.equal(requests, 1);
});

test('Darwin filters use the published destination, operator and via label', async () => {
  await initBoardCache({backend:'sqlite',sqlite:new DatabaseSync(':memory:')});
  await initBoardAdmin({config:{},swissStations:{},norwegianStations:{},belgianStations:{},darwinStations});
  const rows = [
    {destinationNames:['London Kings Cross'], operator:'LNER', viaLabels:['via Doncaster']},
    {destinationNames:['London Kings Cross'], operator:'LNER', viaLabels:[]},
    {destinationNames:['Leeds'], operator:'Northern', viaLabels:['via Doncaster']},
  ];
  const settings = defaultBoardSettings('york');
  settings.directions = [
    {id:'all-matching', label:'London via Doncaster', futureStops:['London Kings Cross'], operator:'lner', via:'Doncaster'},
    {id:'destination', label:'London', futureStops:['London Kings Cross']},
  ];
  const payload = applyBoardSettings('york', {layout:'all-departures', departures:{all:rows}},
    validateBoardSettings('york', settings));
  assert.deepEqual(payload.quick.map(group=>group.trains.length), [1,2]);
  assert.equal(payload.departures.all.length, 3);
});
