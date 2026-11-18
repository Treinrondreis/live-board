// Ritarchief voor volglijsttreinen uit bronnen zonder eigen ritarchief
// (o.a. SNCF, Entur, Trafikverket, RENFE, RFI en DB-treinen die niet via NL/CH/BE rijden).
//
// Uit de vertrekborden kennen we per trein alleen de stations die we zelf volgen.
// Die stations (gepland, verwacht, werkelijk, spoor, uitval) worden per trein per dag
// in journey_archive bewaard, net als de ritten uit NDOV/OJP/NMBS.
// Ritten met id "WL-<bron>|<datum>|wl:<treinnummer>".
import {recordJourneySnapshot, hasSourceJourney} from './journeys.mjs';

const FULL_SOURCES = new Set(['NDOV', 'OJP', 'NMBS']);
const HOUR = 3600000;
const station = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const localDate = ts => new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(ts));
const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function createWatchlistJourneys({includes = null, record = recordJourneySnapshot, exists = hasSourceJourney, clock = Date.now} = {}) {
  const runs = new Map();    // bron|trein -> {date, firstPlanned}: houdt nachttreinen op één dienstdag
  const seen = new Map();    // stop-sleutel -> {sig, at}: alleen wijzigingen opslaan
  const known = new Map();   // trein|datum -> {full, at}: rit al in archief via volledige bron?
  let lastPrune = 0;

  function serviceDate(source, number, planned) {
    const k = source + '|' + number, run = runs.get(k);
    if (run && planned >= run.firstPlanned - 6 * HOUR && planned <= run.firstPlanned + 30 * HOUR) return run.date;
    const date = localDate(planned);
    runs.set(k, {date, firstPlanned: planned});
    return date;
  }
  async function hasFull(number, date) {
    const k = number + '|' + date, hit = known.get(k);
    if (hit && clock() - hit.at < 30 * 60000) return hit.full;
    let full = false;
    try { full = await exists(number, date); } catch { full = false; }
    known.set(k, {full, at: clock()});
    return full;
  }
  function prune(now) {
    if (now - lastPrune < HOUR) return;
    lastPrune = now;
    for (const [k, v] of seen) if (now - v.at > 48 * HOUR) seen.delete(k);
    for (const [k, v] of known) if (now - v.at > 2 * HOUR) known.delete(k);
    for (const [k, v] of runs) if (now - v.firstPlanned > 48 * HOUR) runs.delete(k);
  }

  return async function recordWatchlistJourneys(trains, source, at = clock()) {
    if (!includes || FULL_SOURCES.has(source)) return 0;
    prune(at);
    const groups = new Map();
    for (const t of trains || []) {
      const number = String(t.number || t.trainNumber || '').replace(/^0+(?=\d)/, '');
      const name = String(t.observedAt || t.station || '');
      const mode = t.eventMode || t.mode || 'departure';
      const planned = num(t.plannedTimestamp);
      if (!/^\d+$/.test(number) || !name || !planned || !['arrival', 'departure'].includes(mode)) continue;
      if (!includes({category: t.category, number, station: name, origin: t.from || t.origin, destination: t.to || t.destination, country: t.countryCode})) continue;
      const expected = num(t.expectedTimestamp), actual = num(t.actualTimestamp);
      const realtime = t.hasRealtime === true || Boolean(t.cancelled);
      const plannedPlatform = String(t.plannedTrack || '').trim() || null;
      const platform = String(t.currentTrack || t.track || '').trim() || null;
      const date = serviceDate(source, number, planned);
      const stopKey = [source, number, date, station(name), mode].join('|');
      const sig = JSON.stringify([planned, expected, actual, plannedPlatform, platform, Boolean(t.cancelled), realtime]);
      if (seen.get(stopKey)?.sig === sig) continue;
      const input = {plannedTime: planned, plannedPlatform};
      if (realtime) Object.assign(input, {realtime: true, expectedTime: expected ?? planned, currentPlatform: platform, cancelled: Boolean(t.cancelled)});
      if (actual) Object.assign(input, {realizationConfirmed: true, actualTime: actual, actualPlatform: platform});
      const g = groups.get(number + '|' + date) || {number, date, category: String(t.category || ''), stops: new Map(), marks: []};
      g.marks.push([stopKey, sig]);
      const id = 'wl:' + station(name);
      const stop = g.stops.get(id) || {id, station: name, stationCode: '', sequence: Math.round(planned / 60000)};
      stop[mode] = input;
      if (mode === 'departure' || !g.stops.has(id)) stop.sequence = Math.round(planned / 60000);
      g.stops.set(id, stop);
      groups.set(number + '|' + date, g);
    }
    let written = 0;
    for (const g of groups.values()) {
      const mark = () => { for (const [k, sig] of g.marks) seen.set(k, {sig, at}); };
      if (await hasFull(g.number, g.date)) { mark(); continue; }
      await record({trainNumber: g.number, serviceDate: g.date, journeyRef: 'wl:' + g.number, archiveSource: 'WL-' + source,
        source, sourceTimestamp: at, category: g.category, completePlan: false, stops: [...g.stops.values()]});
      mark(); written++;
    }
    return written;
  };
}

let active = null;
export function configureWatchlistJourneys(options) { active = options ? createWatchlistJourneys(options) : null; }
export async function recordWatchlistJourneys(trains, source, at) { return active ? active(trains, source, at) : 0; }
