// Eenmalige opruiming van train_stop_summaries: verwijdert regels van treinen
// die niet op de volglijst staan (watchlist.mjs).
//
// Starten via Railway-variabele SUMMARY_CLEANUP:
//   SUMMARY_CLEANUP=report  -> alleen tellen, niets verwijderen (veilig)
//   SUMMARY_CLEANUP=delete  -> echt verwijderen, in kleine porties
// Daarna de variabele weer weghalen. Voortgang en resultaat staan in de logs
// met het voorvoegsel "[opruiming]".
import {createWatchlist} from './watchlist.mjs';

// Bij een drukke database (verbinding of query time-out) opnieuw proberen
// in plaats van te stoppen. Halverwege stoppen is veilig: opnieuw starten gaat
// gewoon verder met wat er nog over is.
async function retry(fn, {tries = 30, wait = 5000, log}) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries) throw e;
      log(`[opruiming] Database druk (${e.message}); poging ${i}/${tries}, opnieuw over ${Math.round(wait * i / 1000)} s`);
      await new Promise(r => setTimeout(r, wait * i));
    }
  }
}

export async function cleanupSummaries({q, includes, dryRun = true, batch = 1000, deleteChunk = 250, pause = 300, retryWait = 5000, log = console.log} = {}) {
  let after = '', scanned = 0, keep = 0, removed = 0;
  while (true) {
    const rows = await retry(() => q('SELECT summary_key,source,train_number,category,station,event_mode,payload FROM train_stop_summaries WHERE summary_key > $1 ORDER BY summary_key LIMIT $2', [after, batch]), {wait: retryWait, log});
    if (!rows.length) break;
    after = rows.at(-1).summary_key;
    const drop = [];
    for (const r of rows) {
      let p = {};
      try { p = JSON.parse(r.payload || '{}'); } catch { /* lege payload: alleen kolommen gebruiken */ }
      const e = {category: r.category, number: r.train_number, station: p.station || r.station, origin: p.origin, destination: p.destination, country: p.country, source: r.source};
      if (includes(e)) keep++; else drop.push(r.summary_key);
    }
    scanned += rows.length;
    if (!dryRun) for (let i = 0; i < drop.length; i += deleteChunk) {
      const part = drop.slice(i, i + deleteChunk), args = part.map((_, j) => '$' + (j + 1)).join(',');
      await retry(() => q(`DELETE FROM train_stop_summaries WHERE summary_key IN (${args}) RETURNING summary_key`, part), {wait: retryWait, log});
    }
    removed += drop.length;
    if (scanned % (batch * 100) < batch) log(`[opruiming] ${scanned} bekeken, ${keep} bewaren, ${removed} ${dryRun ? 'zouden weg kunnen' : 'verwijderd'}`);
    if (pause) await new Promise(r => setTimeout(r, pause));
  }
  log(`[opruiming] KLAAR: ${scanned} bekeken, ${keep} bewaren, ${removed} ${dryRun ? 'zouden weg kunnen (niets verwijderd)' : 'verwijderd'}`);
  return {scanned, keep, removed, dryRun};
}

export async function startSummaryCleanup({q, register, mode = process.env.SUMMARY_CLEANUP, log = console.log} = {}) {
  if (!['report', 'delete'].includes(mode)) return null;
  // Register-treinnummers eerst ophalen, zodat geboekte treinen niet per ongeluk verdwijnen.
  let numbers = [];
  try {
    const {available, legs} = await register.summary();
    if (!available && mode === 'delete') { log('[opruiming] Reisschemaregister onbereikbaar: verwijderen afgebroken, niets aangepast.'); return null; }
    numbers = [...new Set((legs || []).map(l => String(l.train_number || '').replace(/\D+/g, '').replace(/^0+(?=\d)/, '')).filter(Boolean))];
  } catch {
    if (mode === 'delete') { log('[opruiming] Reisschemaregister onbereikbaar: verwijderen afgebroken, niets aangepast.'); return null; }
  }
  const watchlist = createWatchlist({extraNumbers: () => numbers});
  log(`[opruiming] Gestart in modus "${mode}" met ${numbers.length} treinnummers uit het register.`);
  return cleanupSummaries({q, includes: watchlist.includes, dryRun: mode !== 'delete', log});
}
