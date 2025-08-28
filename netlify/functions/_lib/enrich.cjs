'use strict';

/**
 * OddsAPI one-shot enrichment.
 * - No rompe el flujo: siempre atrapa errores y retorna null si algo falla.
 * - Respeta envs:
 *    ODDS_API_KEY        (requerida para llamadas reales)
 *    ODDS_REGIONS        (por defecto: "us,uk,eu,au")
 *    ODDS_SPORT_KEY      (fallback si no hay guess)
 *    ODDS_TIMEOUT_MS     (por defecto: 8000)
 *    DEBUG_TRACE         (1 para logs)
 */

let guessSportKeyFromLeague = null;
try {
  ({ guessSportKeyFromLeague } = require('./odds-helpers.cjs'));
} catch (_) {
  // Fallback simple si el helper no está disponible
  guessSportKeyFromLeague = (leagueName) => {
    const s = String(leagueName || '').toLowerCase();
    if (
      s.includes('premier') || s.includes('la liga') ||
      s.includes('serie')   || s.includes('bundes') ||
      s.includes('ligue')   || s.includes('eredivisie')
    ) return 'soccer';
    return process.env.ODDS_SPORT_KEY || 'soccer';
  };
}

function log(...args) {
  if (Number(process.env.DEBUG_TRACE) === 1) {
    console.log('[ENRICH]', ...args);
  }
}

function gentleIncludes(a = '', b = '') {
  a = String(a || '').trim().toLowerCase();
  b = String(b || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function normalizeH2H(bookmaker) {
  const out = [];
  const m = (bookmaker.markets || []).find(x => x.key === 'h2h' && Array.isArray(x.outcomes));
  if (!m) return out;
  for (const o of m.outcomes) {
    if (o && typeof o.price === 'number' && o.name) {
      out.push({ book: bookmaker.title, price: o.price, label: o.name });
    }
  }
  return out;
}

function normalizeTotals(bookmaker) {
  const out = [];
  const m = (bookmaker.markets || []).find(x => x.key === 'totals' && Array.isArray(x.outcomes));
  if (!m) return out;
  for (const o of m.outcomes) {
    if (!o || typeof o.price !== 'number' || !o.name) continue;
    const side = String(o.name || '').toLowerCase().includes('over') ? 'Over' :
                 String(o.name || '').toLowerCase().includes('under') ? 'Under' : o.name;
    const line = (typeof o.point === 'number') ? o.point : (o.point ? Number(o.point) : null);
    const label = line != null ? `${side} ${line}` : side;
    out.push({ book: bookmaker.title, price: o.price, label });
  }
  return out;
}

async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const data = await res.json();
    return { ok: true, data, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

/**
 * fixture esperado:
 *   { home_name, away_name, league_name }
 * retorna:
 *   {
 *     markets: { h2h:[], totals:[], h2h_lay:[] },
 *     meta: {
 *       odds_source: 'oddsapi:events',
 *       odds_event: { id, home, away, commence }
 *     }
 *   }
 * o null si no hay match o error.
 */
async function fetchOddsForFixture(fixture = {}) {
  try {
    const apiKey = String(process.env.ODDS_API_KEY || '');
    if (!apiKey) return null;

    const home = String(fixture.home_name || '').trim();
    const away = String(fixture.away_name || '').trim();
    if (!home || !away) return null;

    const sportKey =
      (typeof guessSportKeyFromLeague === 'function'
        ? guessSportKeyFromLeague(fixture.league_name)
        : null) ||
      process.env.ODDS_SPORT_KEY ||
      'soccer';

    const regions = encodeURIComponent(process.env.ODDS_REGIONS || 'us,uk,eu,au');
    const key     = encodeURIComponent(apiKey);
    const tmo     = Number(process.env.ODDS_TIMEOUT_MS || 8000);

    // 1) Listar eventos
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${key}&regions=${regions}`;
    log('GET', eventsUrl);
    const evRes = await fetchJsonWithTimeout(eventsUrl, tmo);
    if (!evRes.ok || !Array.isArray(evRes.data)) return null;

    // 2) Encontrar evento por nombres
    const ev = evRes.data.find(e =>
      gentleIncludes(e?.home_team, home) && gentleIncludes(e?.away_team, away)
    );
    if (!ev || !ev.id) {
      log('no matching event', { home, away, sportKey });
      return null;
    }

    // 3) Traer cuotas para h2h y totals
    const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${encodeURIComponent(ev.id)}/odds?apiKey=${key}&regions=${regions}&markets=h2h,totals`;
    log('GET', oddsUrl);
    const oddsRes = await fetchJsonWithTimeout(oddsUrl, tmo);
    if (!oddsRes.ok || !oddsRes.data || !Array.isArray(oddsRes.data.bookmakers)) return null;

    const h2h    = [];
    const totals = [];
    for (const bm of oddsRes.data.bookmakers) {
      h2h.push(...normalizeH2H(bm));
      totals.push(...normalizeTotals(bm));
    }

    return {
      markets: { h2h, totals, h2h_lay: [] },
      meta: {
        odds_source: 'oddsapi:events',
        odds_event: {
          id: ev.id,
          home: ev.home_team,
          away: ev.away_team,
          commence: ev.commence_time
        }
      }
    };
  } catch (e) {
    log('error', String(e && e.message ? e.message : e));
    return null;
  }
}

module.exports = { fetchOddsForFixture };
