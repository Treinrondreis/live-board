import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

test('board-cache: zelfde inhoud niet opnieuw, wijzigingen hooguit eens per interval', async () => {
  process.env.BOARD_CACHE_MIN_INTERVAL_SECONDS = '0.2';
  const {initBoardCache, saveBoardCache, loadBoardCache} = await import('./board-cache.mjs');
  const sqlite = new DatabaseSync(':memory:');
  await initBoardCache({backend: 'sqlite', sqlite});
  let writes = 0;
  const prepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = sql => { const st = prepare(sql); if (/INSERT INTO board_cache/.test(sql)) { const run = st.run.bind(st); st.run = (...a) => { writes++; return run(...a); }; } return st; };
  await saveBoardCache('X', {v: 1});
  assert.equal(writes, 1);
  await saveBoardCache('X', {v: 1});
  assert.equal(writes, 1, 'gelijke inhoud wordt overgeslagen');
  await saveBoardCache('X', {v: 2});
  await saveBoardCache('X', {v: 3});
  assert.equal(writes, 1, 'binnen het interval nog niet geschreven');
  await new Promise(r => setTimeout(r, 350));
  assert.equal(writes, 2, 'laatste versie wordt later alsnog weggeschreven');
  assert.deepEqual(await loadBoardCache('X'), {v: 3});
  await saveBoardCache('Y', {v: 1});
  assert.equal(writes, 3, 'andere sleutel direct');
});
