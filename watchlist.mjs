// Volglijst: welke treinen we langdurig bewaren in train_stop_summaries.
// Het live bord toont nog steeds alle treinen; dit bepaalt alleen wat we
// maandenlang bewaren voor vertragingsgeschiedenis.
//
// Een regel past op één samenvattingsregel (één trein op één station) met de
// velden category, number, station, origin, destination.
// Aanpassen? Pas de lijsten hieronder aan; de tests in watchlist.test.mjs
// laten zien welke voorbeeldtreinen wel en niet bewaard worden.
import {reportGroups} from './public/train-report-config.mjs';

export function norm(value) {
  return String(value || '').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
const has = (value, names) => { const v = ' ' + norm(value) + ' '; return names.some(n => v.includes(' ' + n + ' ')); };
const digits = value => String(value || '').replace(/\D+/g, '').replace(/^0+(?=\d)/, '');

// --- Categorieën die we altijd volgen -------------------------------------
const ALWAYS = new Set(['RJ', 'RJX', 'EC', 'NJ', 'EN', 'EST', 'ES', 'EUROSTAR', 'AVE']);

// --- ICE van/naar NL, BE, CH, AT ------------------------------------------
const ICE_ABROAD = [
  // Nederland
  'amsterdam', 'schiphol', 'utrecht', 'arnhem', 'amersfoort', 'deventer', 'hengelo', 'oldenzaal', 'almelo',
  // België
  'brussel', 'bruxelles', 'brussels', 'liege', 'luik', 'antwerpen',
  // Zwitserland
  'basel', 'zurich', 'bern', 'interlaken', 'chur', 'luzern', 'lucerne', 'olten', 'spiez', 'thun', 'brig', 'landquart', 'sargans',
  // Oostenrijk
  'wien', 'salzburg', 'innsbruck', 'linz', 'graz', 'klagenfurt', 'bregenz', 'feldkirch', 'kufstein', 'villach', 'st polten'
];
const ICE_ABROAD_COUNTRIES = new Set(['NL', 'BE', 'CH', 'AT']);
// ICE Düsseldorf – München (inclusief treinen die in het Ruhrgebied beginnen/eindigen)
const RUHR = ['dusseldorf', 'dortmund', 'essen', 'duisburg', 'bochum'];

// --- Stations/plaatsen waar we alles volgen --------------------------------
const ALL_TRAINS_AT = ['montpellier'];
const ALL_TRAINS_NORDIC = ['voss', 'narvik', 'boden', 'boden c'];
const ALL_TRAINS_UK = ['inverness', 'fort william'];
const TGV_ENDPOINTS = ['lille', 'montpellier'];

// --- Trajecten: station én begin- of eindpunt van de trein liggen op de lijn --
const CORRIDORS = [
  {name: 'Paris Austerlitz – Brive – Cahors – Toulouse',
    stations: ['paris austerlitz', 'les aubrais', 'orleans', 'vierzon', 'issoudun', 'chateauroux', 'argenton sur creuse', 'la souterraine',
      'limoges', 'uzerche', 'brive la gaillarde', 'souillac', 'gourdon', 'cahors', 'caussade', 'montauban', 'toulouse matabiau', 'toulouse']},
  {name: 'Narbonne – Collioure', stations: ['narbonne', 'perpignan', 'elne', 'argeles sur mer', 'collioure', 'port vendres', 'banyuls sur mer', 'cerbere', 'portbou']},
  {name: 'Nîmes – Clermont-Ferrand (Cévenol)',
    stations: ['nimes', 'nimes centre', 'ales', 'genolhac', 'villefort', 'la bastide st laurent les bains', 'langogne', 'langeac', 'brioude', 'arvant', 'issoire', 'clermont ferrand']},
  {name: 'Clermont-Ferrand – Paris Bercy', stations: ['clermont ferrand', 'riom', 'vichy', 'saint germain des fosses', 'moulins', 'nevers', 'montargis', 'paris bercy']},
  {name: 'Trondheim – Bodø (Nordlandsbanen)',
    stations: ['trondheim', 'trondheim s', 'stjordal', 'levanger', 'verdal', 'steinkjer', 'snasa', 'grong', 'majavatn', 'mosjoen', 'mo i rana', 'dunderland', 'rognan', 'fauske', 'bodo']},
  // Verenigd Koninkrijk (nog niet gelogd; regels staan klaar)
  {name: 'Glasgow – Mallaig (West Highland)',
    stations: ['glasgow queen street', 'dalmuir', 'helensburgh upper', 'arrochar tarbet', 'crianlarich', 'tyndrum lower', 'upper tyndrum', 'bridge of orchy',
      'rannoch', 'tulloch', 'roy bridge', 'spean bridge', 'fort william', 'glenfinnan', 'lochailort', 'arisaig', 'morar', 'mallaig']},
  {name: 'Newcastle – Edinburgh', stations: ['newcastle', 'morpeth', 'alnmouth', 'berwick upon tweed', 'dunbar', 'edinburgh', 'edinburgh waverley']},
  {name: 'Glasgow – Newcastle', stations: ['glasgow central', 'motherwell', 'carlisle', 'haltwhistle', 'hexham', 'newcastle']}
];

// Treinnummers die de bestaande treinrapporten nodig hebben.
const REPORT_NUMBERS = new Set([...reportGroups.flatMap(g => g.trains), '421', '490', '40421', '40490', '1074', '1072'].map(digits));

export function createWatchlist({extraNumbers = () => []} = {}) {
  function reason(e) {
    if (!e) return null;
    const category = String(e.category || '').toUpperCase().trim();
    const number = digits(e.number);
    const where = [e.station, e.origin, e.destination];
    const endpoints = [e.origin, e.destination];
    if (REPORT_NUMBERS.has(number) && /^(ICE|NJ|EN|RJ|RJX|EC|IC)$/.test(category)) return 'treinrapport';
    for (const n of extraNumbers()) if (n === number) return 'reisschema';
    if (ALWAYS.has(category) || /^EUROSTAR/.test(category)) return 'categorie ' + category;
    if (category === 'ICE') {
      if (ICE_ABROAD_COUNTRIES.has(String(e.country || '').toUpperCase())) return 'ICE buitenland';
      if (where.some(v => has(v, ICE_ABROAD))) return 'ICE buitenland';
      if (endpoints.some(v => has(v, ['munchen'])) && [...endpoints, e.station].some(v => has(v, RUHR))) return 'ICE Düsseldorf – München';
    }
    if (/^TGV|^OUIGO/.test(category) && endpoints.some(v => has(v, TGV_ENDPOINTS))) return 'TGV Lille/Montpellier';
    if (where.some(v => has(v, ALL_TRAINS_AT))) return 'Montpellier';
    if (where.some(v => has(v, ALL_TRAINS_NORDIC))) return 'Voss/Narvik/Boden';
    if (where.some(v => has(v, ALL_TRAINS_UK))) return 'Schotland';
    // Het station en een ánder begin-/eindpunt moeten op hetzelfde traject liggen.
    for (const c of CORRIDORS) if (has(e.station, c.stations) && endpoints.some(v => norm(v) !== norm(e.station) && has(v, c.stations))) return c.name;
    if (endpoints.some(v => has(v, ['glasgow'])) && endpoints.some(v => has(v, ['newcastle']))) return 'Glasgow – Newcastle';
    return null;
  }
  return {reason, includes: e => reason(e) !== null};
}

// Treinnummers uit het reisschemaregister, elk half uur ververst.
export function registerNumbers({register, clock = Date.now, ttl = 30 * 60 * 1000} = {}) {
  let numbers = [], expires = 0, loading = null;
  async function refresh() {
    try {
      const {available, legs} = await register.summary();
      if (available) numbers = [...new Set((legs || []).map(l => digits(l.train_number)).filter(n => n.length >= 2))];
    } catch { /* register onbereikbaar: oude lijst blijft staan */ }
    expires = clock() + ttl; loading = null;
  }
  return () => {
    if (clock() >= expires && !loading) loading = refresh();
    return numbers;
  };
}
