import { timingSafeEqual } from 'node:crypto';
import { floraRegister } from './flora-register.mjs';
import { dailyReportMeasurements } from './punctuality.mjs';

const fields = ['dossier', 'leg_id', 'version_id', 'status', 'role', 'travel_date',
  'arrival_date', 'transport_type', 'train_number', 'from_station', 'to_station',
  'departure_time', 'arrival_time', 'document_url'];

function authorized(header, token) {
  if (!/^[a-f0-9]{64}$/.test(token || '') || typeof header !== 'string') return false;
  const expected = Buffer.from('Bearer ' + token);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function createDailyReportHandler({
  register = floraRegister,
  measurements = dailyReportMeasurements,
  token = () => process.env.DAILY_REPORT_READ_TOKEN,
  clock = () => new Date(),
} = {}) {
  return async (req, res, url) => {
    if (url.pathname !== '/api/internal/daily-report-source') return false;
    const reply = (status, data) => {
      res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
      return true;
    };
    if (!authorized(req.headers.authorization, token())) return reply(401, { error: 'Unauthorized' });
    if (req.method !== 'GET') return reply(405, { error: 'Method not allowed' });
    const day = url.searchParams.get('date') || '';
    const parsed = new Date(day + 'T00:00:00Z');
    const now = clock();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(now);
    const age = (Date.parse(today) - parsed.getTime()) / 86400000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(age) ||
        parsed.toISOString().slice(0, 10) !== day || age < 1 || age > 31) {
      return reply(400, { error: 'Invalid report date' });
    }
    try {
      const data = await register.summary();
      if (!data.available) return reply(503, { error: 'Register unavailable' });
      const legs = data.legs.filter(leg => leg.status === 'active' && leg.travel_date <= day &&
        (leg.arrival_date || leg.travel_date) >= day)
        .map(leg => Object.fromEntries(fields.map(field => [field, leg[field]])));
      const rows = await measurements(legs);
      return reply(200, { fetchedAt: now.toISOString(), reportDate: day, available: true, legs, measurements: rows });
    } catch {
      return reply(503, { error: 'Report source unavailable' });
    }
  };
}

export const handleDailyReportSource = createDailyReportHandler();
