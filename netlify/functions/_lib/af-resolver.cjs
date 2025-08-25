// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolver de IDs para equipos/fixtures usando API-FOOTBALL
 * - Sin nombres fijos de equipos/ligas.
 * - Prioriza liga + temporada cuando hay hint (leagueHint).
 * - Fallback a /teams?search=... si no hay fixtures en rango.
 * - Similaridad basada en tokens normalizados (Jaccard/Dice).
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const DEBUG_TRACE = String(process.env.DEBUG_TRACE || '') === '1';
const SIM_THR = Number(process.env.SIM_THR || '0.72') || 0.72;

function tokenSet(str = '') {
  return new Set(normalizeTeamName(str).split(' ').filter(Boolean));
}
function jaccard(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function dice(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function sim(a, b) {
  if (!a || !b) return 0;
  const na = normalizeTeamName(a), nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(jaccard(na, nb), dice(na, nb));
}

async function afGet(pathAndQuery) {
  if (!API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY not set');
  const base = 'https://v3.football.api-sports.io';
  const url = base + pathAndQuery;
  const _fetch = global.fetch || (await import('node-fetch')).default;
  const r = await _fetch(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
  if (!r.ok) throw new Error(`AF ${pathAndQuery} -> ${r.status}`);
  const j = await r.json();
  if (DEBUG_TRACE) console.log('[AF_DEBUG] GET', pathAndQuery, 'results=', j?.results ?? 'n/a');
  return j;
}

// ------ helpers liga/temporada ---------------------------------------------

async function findLeagueByHint(leagueHint, year) {
  if (!leagueHint) return { leagueId: null, season: null, country: null };
  const L = await afGet(`/leagues?search=${encodeURIComponent(leagueHint)}`).catch(() => null);
  const list = (L && L.response) || [];
  if (!list.length) return { leagueId: null, season: null, country: null };

  // Elige la liga cuyo listado de seasons incluya el año dado; o la "current".
  let picked = null;
  for (const item of list) {
    const seasons = item.seasons || [];
    if (year && seasons.some(s => String(s.year) === String(year))) { picked = item; break; }
    if (!year && seasons.some(s => s.current)) { picked = item; break; }
  }
  if (!picked) picked = list[0];

  const seasons = picked.seasons || [];
  const season = year
    ? (seasons.find(s => String(s.year) === String(year))?.year)
    : (seasons.find(s => s.current)?.year || seasons.at(-1)?.year || null);

  const leagueId = picked?.league?.id || null;
  const country = picked?.country?.name || null;
  if (DEBUG_TRACE) console.log('[AF_DEBUG] league pick', { leagueHint, year, leagueId, season, country });
  return { leagueId, season, country };
}

function ymdUTC(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ------ resolución de equipos/fixtures -------------------------------------

async function listFixturesByRange({ leagueId, season, fromYMD, toYMD }) {
  if (!leagueId || !fromYMD || !toYMD) return [];
  const path = `/fixtures?league=${leagueId}&from=${fromYMD}&to=${toYMD}` +
               (season ? `&season=${season}` : '') + `&timezone=UTC`;
  const J = await afGet(path).catch(() => null);
  return (J && J.response) || [];
}

async function searchTeamsRaw({ leagueId, season, qRaw, country }) {
  // Si hay liga, acota por liga+temporada que es mucho más preciso.
  let path = leagueId
    ? `/teams?league=${leagueId}${season ? `&season=${season}` : ''}&search=${encodeURIComponent(qRaw)}`
    : `/teams?search=${encodeURIComponent(qRaw)}`;

  // Hint de país (si viene de la liga elegida)
  if (!leagueId && country) path += `&country=${encodeURIComponent(country)}`;

  const J = await afGet(path).catch(() => null);
  return (J && J.response) || [];
}

async function pickTeamId(_afApi_unused, rawName, { leagueHint, commence } = {}) {
  const qRaw = String(rawName || '').trim();
  if (!qRaw) return null;

  const want = normalizeTeamName(qRaw);
  const year = commence ? new Date(commence).getUTCFullYear() : null;

  const { leagueId, season, country } = await findLeagueByHint(leagueHint, year);

  // 1) primera opción: inferir por FIXTURES del día (si leagueId)
  if (leagueId && commence) {
    const day = ymdUTC(commence);
    const fixtures = await listFixturesByRange({ leagueId, season, fromYMD: day, toYMD: day });
    let best = { id: null, score: -1 };
    for (const fx of fixtures) {
      const home = fx?.teams?.home?.name || '';
      const away = fx?.teams?.away?.name || '';
      const sH = sim(want, home);
      const sA = sim(want, away);
      const score = Math.max(sH, sA);
      if (score > best.score) {
        best = {
          id: sH >= sA ? (fx?.teams?.home?.id || null) : (fx?.teams?.away?.id || null),
          score
        };
      }
    }
    if (DEBUG_TRACE) console.log('[AF_DEBUG] fixtures scan best', { qRaw, want, best });
    if (best.id && best.score >= SIM_THR) return best.id;
  }

  // 2) fallback: /teams?search (acotado por liga+season si existe)
  const candidates = await searchTeamsRaw({ leagueId, season, qRaw, country });
  let bestId = null, bestScore = -1;
  for (const it of candidates) {
    const name = it?.team?.name || '';
    if (!name) continue;
    const score = sim(want, name);
    if (score > bestScore) { bestScore = score; bestId = it.team.id || null; }
  }
  if (DEBUG_TRACE) console.log('[AF_DEBUG] teams search best', { qRaw, want, bestId, bestScore });

  return (bestScore >= SIM_THR) ? bestId : null;
}

async function resolveTeamsAndLeague(evt = {}, opts = {}) {
  const home = evt.home || evt.home_team || evt?.teams?.home?.name || '';
  const away = evt.away || evt.away_team || evt?.teams?.away?.name || '';
  const leagueHint = opts.leagueHint || evt.liga || evt.league || '';
  const commence = opts.commence || evt.commence || null;

  const hId = await pickTeamId(null, home, { leagueHint, commence });
  const aId = await pickTeamId(null, away, { leagueHint, commence });

  return {
    ok: Boolean(hId && aId),
    reason: (hId && aId) ? null : 'unresolved_id',
    home, away,
    league: leagueHint || null,
    homeId: hId || null,
    awayId: aId || null
  };
}

module.exports = { sim, pickTeamId, resolveTeamsAndLeague };
