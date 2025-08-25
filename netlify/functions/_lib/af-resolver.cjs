// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolución basada en API-FOOTBALL SIN hardcodes:
 * 1) Intenta localizar fixture del día (league+season + date + timezone=UTC).
 * 2) Si no hay fixture, busca teamIds por /teams (filtrado por liga+temporada si es posible).
 * 3) Último recurso: /teams?search=<name> sin liga.
 *
 * Env necesarios (scope: functions):
 * - API_FOOTBALL_KEY
 * Env/knobs opcionales:
 * - SIM_THR (umbral de similitud 0..1)  [def: 0.60]
 * - DEBUG_TRACE (1 para logs)
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

// --------- knobs ----------
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const SIM_THR = (() => {
  const x = parseFloat(process.env.SIM_THR || '');
  return Number.isFinite(x) ? x : 0.60;
})();
const DEBUG = String(process.env.DEBUG_TRACE || '') === '1';

// --------- utils ----------
function log(...args) { if (DEBUG) console.log('[AF_DEBUG]', ...args); }

function normTokens(s = '') {
  // normaliza y deja tokens básicos
  return normalizeTeamName(String(s))
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenSet(s = '') {
  return new Set(normTokens(s).split(' ').filter(Boolean));
}
function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function dice(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function sim(a, b) {
  const na = normTokens(a), nb = normTokens(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(jaccard(na, nb), dice(na, nb));
}

async function afFetch(pathAndQuery) {
  if (!API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY not set');
  const base = 'https://v3.football.api-sports.io';
  const url = base + pathAndQuery;
  const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
  const _fetch = global.fetch || (await import('node-fetch')).default;
  log('GET', url);
  const res = await _fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`AF ${res.status} ${pathAndQuery} :: ${txt.slice(0, 200)}`);
  }
  const json = await res.json();
  return json && json.response ? json.response : [];
}

// yyyy-mm-dd en UTC
function ymdUTC(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Busca liga+temporada dada una pista de liga (string) y un commence opcional
async function resolveLeagueSeason(leagueHint, commence) {
  if (!leagueHint) return { leagueId: null, season: null };
  const encoded = encodeURIComponent(leagueHint);
  const L = await afFetch(`/leagues?search=${encoded}`);
  if (!Array.isArray(L) || L.length === 0) return { leagueId: null, season: null };

  const year = commence ? new Date(commence).getUTCFullYear() : null;
  let picked = null;

  for (const item of L) {
    const seasons = Array.isArray(item.seasons) ? item.seasons : [];
    if (year && seasons.some(s => String(s.year) === String(year))) {
      picked = item;
      break;
    }
    if (!year && seasons.some(s => s.current)) {
      picked = item;
      break;
    }
  }
  if (!picked) picked = L[0];

  const leagueId = picked?.league?.id || null;
  const seasonsArr = Array.isArray(picked?.seasons) ? picked.seasons : [];
  const season = year
    ? (seasonsArr.find(s => String(s.year) === String(year))?.year ?? null)
    : (seasonsArr.find(s => s.current)?.year ?? seasonsArr.at(-1)?.year ?? null);

  log('leagueSeason', { leagueHint, leagueId, season, year });
  return { leagueId, season };
}

// Lista fixtures de una liga en fecha exacta (UTC)
async function listFixturesByLeagueDay(leagueId, season, dateYMD) {
  if (!leagueId || !season || !dateYMD) return [];
  const resp = await afFetch(
    `/fixtures?league=${leagueId}&season=${season}&date=${dateYMD}&timezone=UTC`
  );
  return Array.isArray(resp) ? resp : [];
}

// Busca teamId por /teams con filtros (liga+temporada) o sólo search si no hay liga
async function pickTeamId(afApi, rawName, { leagueId, season } = {}) {
  const q = String(rawName || '').trim();
  if (!q) return null;
  const enc = encodeURIComponent(q);

  let path;
  if (leagueId && season) {
    path = `/teams?league=${leagueId}&season=${season}&search=${enc}`;
  } else {
    path = `/teams?search=${enc}`;
  }
  const teams = await afApi(path); // espera array .response ya desenvuelto
  let bestId = null, bestScore = -1;
  for (const item of teams) {
    const name = item?.team?.name || '';
    const id = item?.team?.id || null;
    if (!name || !id) continue;
    const s = sim(q, name);
    if (s > bestScore) {
      bestScore = s;
      bestId = id;
    }
  }
  log('pickTeamId', { q, leagueId, season, bestId, bestScore });
  if (bestId && bestScore >= SIM_THR) return bestId;
  return null;
}

// --- API adapter compatible con afFetch (devuelve response array directo)
async function afApi(pathWithQuery) {
  const arr = await afFetch(pathWithQuery);
  return arr; // ya es .response
}

/**
 * resolveTeamsAndLeague(evt, opts):
 *  - evt: { home, away, liga?, commence? }
 *  - opts: { leagueHint?, commence?, windowPadMin? }  (windowPadMin no se usa aquí)
 *
 * Devuelve:
 * {
 *   ok: boolean,
 *   reason: string|null,
 *   confidence: number|null,
 *   home, away, liga,
 *   homeId, awayId,
 *   league_id: number|null,
 *   fixture_id: number|null
 * }
 */
async function resolveTeamsAndLeague(evt = {}, opts = {}) {
  const home = String(evt.home || '').trim();
  const away = String(evt.away || '').trim();
  const liga = String(opts.leagueHint || evt.liga || '').trim();
  const commence = opts.commence || evt.commence || null;

  const out = {
    ok: false,
    reason: null,
    confidence: null,
    home, away, liga,
    homeId: null,
    awayId: null,
    league_id: null,
    fixture_id: null,
  };

  try {
    if (!home || !away) {
      out.reason = 'missing_teams';
      return out;
    }
    if (!API_FOOTBALL_KEY) {
      out.reason = 'no_api_key';
      return out;
    }

    // 1) liga+temporada (si hay pista de liga)
    let leagueId = null, season = null;
    if (liga) {
      const ls = await resolveLeagueSeason(liga, commence);
      leagueId = ls.leagueId;
      season = ls.season;
      out.league_id = leagueId || null;
    }

    // 2) Fecha
    const dateYMD = commence ? ymdUTC(commence) : null;

    // 3) Camino A: Buscar fixture del día en la liga detectada
    if (leagueId && season && dateYMD) {
      const fixtures = await listFixturesByLeagueDay(leagueId, season, dateYMD);
      log('fixtures.len', fixtures.length);
      let best = null, bestScore = -1;

      for (const fx of fixtures) {
        const th = fx?.teams?.home?.name || '';
        const ta = fx?.teams?.away?.name || '';
        const s1 = sim(home, th);
        const s2 = sim(away, ta);
        const s = Math.min(s1, s2); // ambas deben parecerse
        if (s > bestScore) {
          bestScore = s;
          best = fx;
        }
      }

      if (best && bestScore >= SIM_THR) {
        out.homeId = best?.teams?.home?.id ?? null;
        out.awayId = best?.teams?.away?.id ?? null;
        out.fixture_id = best?.fixture?.id ?? null;
        out.ok = Boolean(out.homeId && out.awayId);
        out.confidence = bestScore;
        if (out.ok) return out;
      }
    }

    // 4) Camino B: teamIds por /teams (filtrando por liga+temporada si disponibles)
    {
      const hId = await pickTeamId(afApi, home, { leagueId, season });
      const aId = await pickTeamId(afApi, away, { leagueId, season });
      if (hId && aId) {
        out.homeId = hId;
        out.awayId = aId;
        out.ok = true;
        out.confidence = 0.66; // “media” cuando no vino de fixture directo
        return out;
      }
    }

    // 5) Camino C: último recurso /teams?search sin liga
    {
      const hId = await pickTeamId(afApi, home, {});
      const aId = await pickTeamId(afApi, away, {});
      if (hId && aId) {
        out.homeId = hId;
        out.awayId = aId;
        out.ok = true;
        out.confidence = 0.55; // menor confianza sin liga
        return out;
      }
    }

    out.reason = out.reason || 'not_found';
    return out;
  } catch (e) {
    out.reason = `error:${e && e.message || e}`;
    return out;
  }
}

// Exports
module.exports = {
  sim,
  pickTeamId,
  resolveTeamsAndLeague,
};
