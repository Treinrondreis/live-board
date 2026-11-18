import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReportEvent} from './day-reports.mjs';
import {retentionPolicy} from './board-cache.mjs';

const base = {number: '123', category: 'ICE', station: 'Utrecht Centraal', eventMode: 'departure', plannedTimestamp: Date.UTC(2026, 10, 18, 9), from: 'Amsterdam Centraal', to: 'Frankfurt(Main)Hbf'};

test('samenvatting bewaart gepland en actueel spoor', () => {
  const e = normalizeReportEvent({...base, plannedTrack: '18', track: '19'}, 'NDOV', 1);
  assert.equal(e.plannedPlatform, '18');
  assert.equal(e.platform, '19');
});

test('zonder spoor geen lege spoorvelden', () => {
  const e = normalizeReportEvent(base, 'NDOV', 1);
  assert.equal('platform' in e, false);
  assert.equal('plannedPlatform' in e, false);
});

test('ruwe data ICE/NJ/RJ 7 dagen, overige 3 dagen', () => {
  assert.equal(retentionPolicy.defaultDays, 3);
  assert.equal(retentionPolicy.extendedDays, 7);
});
