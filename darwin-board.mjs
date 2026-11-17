const endpoint = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard';
export const darwinStations = Object.freeze({
  'london-paddington': { crs: 'PAD', name: 'London Paddington' },
  york: { crs: 'YRK', name: 'York' },
  inverness: { crs: 'INV', name: 'Inverness' },
});

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function reading(service, key, reference) {
  if (service[key + 'Specified'] === false) return null;
  const value = service[key];
  if (typeof value !== 'string') return null;
  const clock = /^([01]\d|2[0-3]):?([0-5]\d)(?::?[0-5]\d)?$/.exec(value);
  if (clock) {
    const local = timeFormat.format(new Date(reference)).split(':').map(Number);
    const difference = Number(clock[1]) * 60 + Number(clock[2]) - local[0] * 60 - local[1];
    const minutes = ((difference + 2160) % 1440) - 720;
    return { time: clock[1] + ':' + clock[2], timestamp: reference - reference % 60000 + minutes * 60000 };
  }
  const timestamp = Date.parse(value);
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(timestamp) ||
      !/(Z|[+-]\d\d:\d\d)$/i.test(value) || Math.abs(timestamp - reference) > 86400000) return null;
  return { time: timeFormat.format(new Date(timestamp)).slice(0, 5), timestamp };
}

function normalizeDeparture(service, now) {
  if (!service || service.serviceIsSupressed || service.serviceIsSuppressed || service.isPass) return null;
  const planned = reading(service, 'std', now);
  if (!planned) return null;
  const departureStatus = typeof service.etd === 'string' ? service.etd.trim().toLowerCase() : '';
  const cancelled = service.isCancelled === true || departureStatus === 'cancelled';
  const actual = service.departureTypeSpecified !== false && service.departureType === 'Actual'
    ? reading(service, 'atd', planned.timestamp) : null;
  if (actual && !cancelled) return null;
  const expected = departureStatus === 'on time' ? planned : reading(service, 'etd', planned.timestamp);
  const delayed = departureStatus === 'delayed' || service.departureType === 'Delayed';
  const destinations = service.currentDestinations?.length ? service.currentDestinations : service.destination;
  const to = Array.isArray(destinations) ? destinations.map(stop => stop?.locationName).filter(Boolean).join(' / ') : '';
  const delay = expected ? Math.round((expected.timestamp - planned.timestamp) / 60000) : null;
  return {
    id: String(service.serviceID || service.rid || [service.uid, planned.timestamp, to].join('|')),
    source: 'DARWIN', train: service.operator || 'Trein', number: '', category: '',
    plannedTime: planned.time, time: cancelled ? planned.time : expected?.time || planned.time,
    to: to || 'Onbekend', track: service.platformIsHidden ? '—' : service.platform || '—',
    cancelled, delay, hasRealtime: Boolean(expected || cancelled || delayed),
    status: cancelled ? 'Geannuleerd' : delay > 0 ? '+' + delay
      : delayed && !expected ? 'Vertraagd' : expected ? 'Op tijd' : '',
    type: cancelled ? 'cancel' : delay > 0 ? 'delay' : 'normal',
    plannedTimestamp: planned.timestamp,
  };
}

export function createDarwinBoards({
  fetchBoard = globalThis.fetch,
  clock = Date.now,
  apiKey = () => process.env.RDM_LDB_API_KEY,
  reportFailure = (crs, reason) => console.warn('[Darwin LDB] '+crs+' '+reason),
} = {}) {
  const cache = new Map();
  async function refresh(station, entry) {
    try {
      const key = apiKey()?.trim();
      if (!key) return reportFailure(station.crs, 'missing-key');
      const now = clock();
      const url = endpoint + '/' + station.crs + '?numRows=30';
      const response = await fetchBoard(url, {
        headers: { 'x-apikey': key, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return reportFailure(station.crs, 'HTTP '+response.status);
      const data = await response.json();
      if (data?.crs !== station.crs || (data.trainServices != null && !Array.isArray(data.trainServices))) return reportFailure(station.crs, 'invalid-board');
      if (!Object.hasOwn(data, 'trainServices') && !data.generatedAt) return reportFailure(station.crs, 'missing-board');
      entry.rows = (data.trainServices || []).map(service => normalizeDeparture(service, now)).filter(Boolean)
        .sort((a, b) => a.plannedTimestamp - b.plannedTimestamp);
      entry.updated = now;
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'timeout' : error?.name === 'SyntaxError' ? 'invalid-json' : 'request-failed';
      reportFailure(station.crs, reason);
      // A failed refresh leaves the last successful result in place.
    } finally {
      entry.retryAt = clock() + 60000;
      entry.pending = null;
    }
  }
  return async page => {
    if (!Object.hasOwn(darwinStations, page)) return null;
    const station = darwinStations[page];
    if (!cache.has(page)) cache.set(page, { rows: [], updated: null, retryAt: 0, pending: null });
    const entry = cache.get(page);
    if (!entry.pending && clock() >= entry.retryAt) {
      entry.pending = Promise.resolve().then(() => refresh(station, entry));
    }
    if (entry.pending && entry.updated === null) await entry.pending;
    const age = entry.updated === null ? Infinity : clock() - entry.updated;
    const rows = age < 300000 ? entry.rows : [];
    return {
      source: 'National Rail Darwin', page, station: station.name, title: station.name, country: 'GB', layout: 'all-departures',
      lastScanAt: entry.updated === null ? null : new Date(entry.updated).toISOString(),
      status: age < 120000 ? 'ready' : 'unavailable',
      notice: age >= 120000 ? 'Live vertrekgegevens tijdelijk niet beschikbaar.' : '',
      departures: { all: rows, fernverkehr: [], regional: [] },
    };
  };
}

export const darwinBoard = createDarwinBoards();
