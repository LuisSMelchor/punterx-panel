// netlify/functions/_lib/fetch-odds.cjs
'use strict';

/**
 * Anchor (header):
 * - Safe logs only: [AF_DEBUG]
 * - No secrets exposed: usa process.env por nombre
 * - Diseñado para ser importado por funciones diag/autopick
 */

const fetch = global.fetch || ((...a)=>import('node-fetch').then(m=>m.default(...a)));

const ODDS_API_KEY = process.env.ODDS_API_KEY; // <- placeholder
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';
let SPORT_KEY     = process.env.ODDS_API_SPORT_KEY || 'soccer'; // p.ej. 'soccer' o 'soccer_epl'
const MARKET_LIST   = process.env.ODDS_API_MARKETS   || 'h2h,totals,spreads'; // ajustar luego si hace falta
const REGION        = process.env.ODDS_API_REGION    || 'eu'; // eu | uk | us | au



try {


  const LEAGUE_NAME = process.env.ODDS_LEAGUE_NAME || "";



    if (g) SPORT_KEY = g;

    if (process.env.LOG_VERBOSE === "1") {

      console.log("[AF_DEBUG] fetch-odds: league→sport_key", { league: LEAGUE_NAME, sport_key: SPORT_KEY });

    }


} catch (_) { /* helper opcional: fallback limpio */ }

const DATE_FROM_MIN = parseInt(process.env.WINDOW_FB_MIN_MIN || '45', 10); // ventana mínima (minutos)
const DATE_TO_MIN   = parseInt(process.env.WINDOW_FB_MAX_MIN || '55', 10); // ventana máxima (minutos)

/**
 * Normalización muy básica (anchor pre-impl):
 * Reemplaza tokens frecuentes, quita puntos y dobles espacios
 */
function normalizeName(s='') {
  return String(s)
    .normalize('NFKD')
    .replace(/\./g, ' ')
    .replace(/\s+FC$/i, '')
    .replace(/\s+F\.?C\.?$/i, '')
    .replace(/\s+SC$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve eventos con cuotas en la ventana [t0+min, t0+max] (minutos)
 * Estructura: { ts, league, home, away, markets: {...}, raw:{...} }
 */
async function fetchOddsEvents({ now = new Date() } = {}) {
  if (!ODDS_API_KEY) {
    console.log('[AF_DEBUG] fetch-odds: missing ODDS_API_KEY (dev fallback: returning empty)');
    return { ok: true, count: 0, events: [], reason: 'no_key' };
  }

  const from = new Date(now.getTime() + DATE_FROM_MIN * 60 * 1000).toISOString();
  const to   = new Date(now.getTime() + DATE_TO_MIN   * 60 * 1000).toISOString();

  // OddsAPI endpoint: upcoming events con mercados seleccionados
  // Nota: algunos deportes usan claves más específicas (p.ej. soccer_epl)
  const url = `${ODDS_API_BASE}/sports/${encodeURIComponent(SPORT_KEY)}/odds` +
              `?regions=${encodeURIComponent(REGION)}` +
              `&markets=${encodeURIComponent(MARKET_LIST)}` +
              `&oddsFormat=decimal` +
              `&dateFormat=iso` +
              `&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;

  let res;
  try {
    res = await fetch(url, { method: 'GET', timeout: 20000 });
  } catch (e) {
    console.log('[AF_DEBUG] fetch-odds: network_error', { message: e?.message });
    return { ok: false, count: 0, events: [], reason: 'network_error' };
  }

  if (!res.ok) {
    const text = await res.text().catch(()=>String(res.status));
    console.log('[AF_DEBUG] fetch-odds: http_error', { status: res.status, text: String(text).slice(0, 200) });
    return { ok: false, count: 0, events: [], reason: `http_${res.status}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.log('[AF_DEBUG] fetch-odds: json_parse_error', { message: e?.message });
    return { ok: false, count: 0, events: [], reason: 'bad_json' };
  }

  // Filtrado por ventana de tiempo usando commence_time si está disponible
  const tFrom = new Date(from).getTime();
  const tTo   = new Date(to).getTime();

  const events = (Array.isArray(data) ? data : []).map(ev => {
    const league = normalizeName(ev?.sport_title || ev?.league || '');
    const home   = normalizeName(ev?.home_team || '');
    const away   = normalizeName(ev?.away_team || '');
    const tsISO  = ev?.commence_time || ev?.commence_time_iso || null;
    const ts     = tsISO ? new Date(tsISO).getTime() : null;

    const markets = {};
    // compactar algunas cotizaciones comunes (h2h/totals/spreads)
    if (Array.isArray(ev?.bookmakers)) {
      for (const bk of ev.bookmakers) {
        if (!Array.isArray(bk?.markets)) continue;
        for (const m of bk.markets) {
          if (!m?.key) continue;
          if (!markets[m.key]) markets[m.key] = [];
          markets[m.key].push({
            bookmaker: bk.key || bk.title,
            lastUpdate: m.last_update,
            outcomes: m.outcomes || []
          });
        }
      }
    }

    return { ts, tsISO, league, home, away, markets, raw: ev };
  }).filter(e => {
    if (!e.ts) return false;
    return e.ts >= tFrom && e.ts <= tTo;
  });

  console.log('[AF_DEBUG] fetch-odds: result', {
    windowMin: { from: DATE_FROM_MIN, to: DATE_TO_MIN },
    count: events.length
  });

  return { ok: true, count: events.length, events };
}

module.exports = {
  fetchOddsEvents,
  normalizeName,
};
