import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyReportHandler } from './daily-report-source.mjs';

const secret = '1'.repeat(64);
const now = new Date('2026-11-17T11:00:00Z');

test('the report source requires its own token and accepts only GET for a recent report date', async () => {
  let registerReads = 0;
  const handler = createDailyReportHandler({
    token: () => secret, clock: () => now,
    register: { summary: async () => {
      registerReads++;
      return {available: true, legs: [
        {leg_id: 'one', version_id: 'v1', dossier: '0001A', status: 'active',
          travel_date: '2026-11-16', arrival_date: '2026-11-17', private_field: 'not exported'},
        {leg_id: 'two', status: 'active', travel_date: '2026-11-15'},
        {leg_id: 'three', status: 'inactive', travel_date: '2026-11-16'},
      ]};
    } },
    measurements: async legs => {
      assert.deepEqual(legs.map(leg => leg.leg_id), ['one']);
      return [{leg_id: 'one', version_id: 'v1'}];
    },
  });
  async function call({token, method = 'GET', date = '2026-11-16'} = {}) {
    let result;
    const res = {
      writeHead(status, headers) { result = {status, headers}; },
      end(body) { result.body = JSON.parse(body); },
    };
    await handler({method, headers: {authorization: token && 'Bearer ' + token}}, res,
      new URL('https://example.invalid/api/internal/daily-report-source?date=' + date));
    return result;
  }
  assert.equal((await call()).status, 401);
  assert.equal((await call({token: '2'.repeat(64)})).status, 401);
  assert.equal((await call({token: secret, method: 'POST'})).status, 405);
  assert.equal((await call({token: secret, date: '2026-11-17'})).status, 400);
  assert.equal(registerReads, 0);
  const result = await call({token: secret});
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.legs[0].private_field, undefined);
  assert.deepEqual(result.body.measurements, [{leg_id: 'one', version_id: 'v1'}]);
});
