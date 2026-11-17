import assert from 'node:assert/strict';
import test from 'node:test';
import { createDarwinBoards } from './darwin-board.mjs';

test('shares a departure request and preserves the distinction between live and scheduled', async () => {
  let requests = 0;
  const board = createDarwinBoards({
    clock: () => Date.parse('2026-07-01T22:55:00Z'),
    apiKey: () => 'fixture-key',
    fetchBoard: async (url, options) => {
      requests++;
      assert.match(url, /GetDepBoardWithDetails\/YRK\/20260701T235500\?numRows=30$/);
      assert.equal(options.headers['x-apikey'], 'fixture-key');
      assert.equal(options.redirect, 'error');
      return {ok: true, json: async () => ({crs: 'YRK', trainServices: [
        {rid: '1', std: '23:57', etd: '00:03', destination: [{locationName: 'Teststation'}]},
        {rid: '2', std: '23:59', isCancelled: true},
        {rid: '3', std: '00:01', etd: '00:01', etdSpecified: false},
        {rid: '4', std: '00:03', departureType: 'Delayed'},
      ]})};
    },
  });
  const [a, b] = await Promise.all([board('york'), board('york')]);
  assert.deepEqual(a, b);
  assert.equal(requests, 1);
  assert.equal(a.status, 'ready');
  assert.deepEqual(a.departures.all.map(r => [r.delay, r.cancelled, r.hasRealtime]),
    [[6, false, true], [null, true, true], [null, false, false], [null, false, true]]);
  assert.equal(a.departures.all[3].status, 'Vertraagd');
  assert.equal(JSON.stringify(a).includes('fixture-key'), false);
  assert.equal(await board('unsupported'), null);
});

test('does not continuously retry an unavailable feed', async () => {
  let requests = 0;
  const board = createDarwinBoards({
    apiKey: () => 'fixture-key',
    fetchBoard: async () => { requests++; return {ok: false, status: 403}; },
  });
  assert.equal((await board('inverness')).status, 'unavailable');
  assert.equal((await board('inverness')).status, 'unavailable');
  assert.equal(requests, 1);
});
