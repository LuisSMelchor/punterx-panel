// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolver AF:
 * - Sin hardcode de equipos/ligas.
 * - 1) Busca fixture por rango alrededor de `commence` (o hoy).
 * - 2) Si no hay fixture, busca teamIds por /teams (con liga+temporada si hay pista).
 * - 3) Fallback amplio por /teams?search=
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const DEBUG_TRACE = String(process.env.DEBUG_TRACE || '0') === '1';

// Umbral de similitud: usa env SIM_THR si existe, si no 0.70
const SIM_THR = (() => {
  const n = Number(process.env.SIM_THR);
  return Number.isFinite(n) ? n : 0.70;
})();

// ===== util de similitud por tokens (conservador) =====
function tokenSet(str = '') {
  return new Set(
    normalizeTeamName(str)
      .split(' ')
      .filter(Boolean)
  );
}
function jaccard(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}
function dice(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function sim(a, b) {
  if (!a || !b) return 0;
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(jaccard(na, nb), dice(na, nb));
}

// ===== cliente AF genérico =====
async function afFetch(pathAndQuery) {
  if (!API_KEY) {
    if (DEBUG_TRACE) console.warn('af-resolver.cjs: falta API_FOOTBALL_KEY en el entorno');
    throw new Error('AF_KEY_MISSING');
  }
  const base = 'https://v3.football.api-sports.io';
  const url = new URL(pathAndQuery.startsWith('/') ? base + pathAndQuery : `${base}/${pathAndQuery}`);
  const headers = { 'x-apisports-key': API_KEY };

  const _fetch = globalThis.fetch || (await import('node-fetch')).default;
  const res = await _fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AF ${url.pathname}${url.search} ${res.status} ${body?.slice(0, 140)}`);
  }
  return res.json();
}

// Exponemos por compatibilidad (otras funciones pueden llamarlo)
async function afApi(pathAndQuery) {
  return afFetch(pathAndQuery);
}

// ===== helpers de fechas =====
function toYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
function clampRangeFromCommence(commenceIso, padMin) {
  // Rango centrado en commence (UTC), de +/- padMin minutos (mínimo 0 => día de commence)
  const pad = Math.max(Number(padMin || 0), 0);
  const c = new Date(commenceIso);
  if (Number.isNaN(c.getTime())) {
    // Si commence inválido, usar “hoy” UTC
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    return { from: toYMD(from), to: toYMD(to), dayYear: now.getUTCFullYear() };
  }
  if (pad === 0) {
    const from = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), 0, 0, 0));
    const to = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), 23, 59, 59));
    return { from: toYMD(from), to: toYMD(to), dayYear: c.getUTCFullYear() };
  }
  const fromMs = c.getTime() - pad * 60 * 1000;
  const toMs = c.getTime() + pad * 60 * 1000;
  const from = new Date(fromMs);
  const to = new Date(toMs);
  return { from: toYMD(from), to: toYMD(to), dayYear: c.getUTCFullYear() };
}

// ===== liga + temporada a partir del hint =====
async function resolveLeagueAndSeason(leagueHint, commenceIso) {
  if (!leagueHint) return { leagueId: null, season: null };

  const L = await afApi(`/leagues?search=${encodeURIComponent(leagueHint)}`).catch(() => null);
  const items = (L && L.response) || [];
  if (!items.length) return { leagueId: null, season: null };

  const want = normalizeTeamName(leagueHint);
  const year = commenceIso ? new Date(commenceIso).getUTCFullYear() : null;

  // pick la liga cuya similitud con el nombre sea mayor y cuya seasons incluya el año (si hay), o la current
  let best = null;
  let bestScore = -1;
  for (const it of items) {
    const name = it?.league?.name || '';
    const s = sim(want, name);
    if (s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  if (!best || !best.league || !best.league.id) return { leagueId: null, season: null };

  const seasons = best.seasons || [];
  const season = year
    ? (seasons.find(s => String(s.year) === String(year))?.year)
    : (seasons.find(s => s.current)?.year || seasons.at(-1)?.year || null);

  return { leagueId: best.league.id, season: season || null };
}

// ===== fixtures por rango (opcionalmente filtrado por liga+season) =====
async function listFixturesByRange({ from, to, leagueId, season }) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  else if (from) { qs.set('date', from); }
  if (leagueId) qs.set('league', String(leagueId));
  if (season) qs.set('season', String(season));
  // timezone no es obligatorio: trabajamos en UTC
  const j = await afApi(`/fixtures?${qs.toString()}`).catch(() => null);
  return (j && j.response) || [];
}

// ===== selección del mejor fixture por similitud de nombres =====
function resolveFixtureFromList(list, homeRaw, awayRaw) {
  const wantH = normalizeTeamName(homeRaw);
  const wantA = normalizeTeamName(awayRaw);
  let best = null;
  let bestScore = -1;

  for (const f of list) {
    const hName = f?.teams?.home?.name || '';
    const aName = f?.teams?.away?.name || '';
    if (!hName || !aName) continue;

    const score = (sim(wantH, hName) + sim(wantA, aName)) / 2;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }

  if (best && bestScore >= SIM_THR) {
    return {
      ok: true,
      score: bestScore,
      fixture_id: best.fixture?.id || null,
      league_id: best.league?.id || null,
      season: best.league?.season || null,
      homeId: best.teams?.home?.id || null,
      awayId: best.teams?.away?.id || null,
    };
  }
  return { ok: false, score: bestScore, reason: 'NO_FIXTURE_MATCH' };
}

// ===== búsqueda de teamId por /teams (con filtro de liga cuando se puede) =====
async function pickTeamId(rawName, { leagueId, season } = {}) {
  const qRaw = String(rawName || '').trim();
  if (!qRaw) return null;

  // 1) si hay liga/season, intentar ahí primero
  let teams = [];
  if (leagueId) {
    const q1 = new URLSearchParams();
    q1.set('league', String(leagueId));
    if (season) q1.set('season', String(season));
    q1.set('search', qRaw);
    const j1 = await afApi(`/teams?${q1.toString()}`).catch(() => null);
    teams = (j1 && j1.response) || [];
  }

  // 2) fallback amplio
  if (!teams.length) {
    const j2 = await afApi(`/teams?search=${encodeURIComponent(qRaw)}`).catch(() => null);
    teams = (j2 && j2.response) || [];
  }

  if (!teams.length) return null;

  // 3) elegir por similitud
  const want = normalizeTeamName(qRaw);
  let bestId = null, bestScore = -1;
  for (const it of teams) {
    const name = it?.team?.name || '';
    if (!name) continue;
    const s = sim(want, name);
    if (s > bestScore) {
      bestScore = s;
      bestId = it?.team?.id || null;
    }
  }

  if (DEBUG_TRACE) console.log('[AF pickTeamId]', { raw: qRaw, leagueId: leagueId || null, season: season || null, bestScore });

  if (bestScore < SIM_THR) return null;
  return bestId;
}

// ===== API principal para tu pipeline =====
async function resolveTeamsAndLeague(evt = {}, opts = {}) {
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const liga = evt.liga || evt.league || evt.league_name || evt.leagueName || opts.leagueHint || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || opts.commence || null;

  const windowPadMin = Number(opts.windowPadMin ?? 60); // por defecto ±60m alrededor del commence
  const { from, to, dayYear } = clampRangeFromCommence(commence, windowPadMin);

  if (DEBUG_TRACE) console.log('[AF resolve] input', { home, away, liga, commence, from, to, SIM_THR });

  // 1) liga+temporada
  const { leagueId, season } = await resolveLeagueAndSeason(liga, commence).catch(() => ({ leagueId: null, season: null }));
  if (DEBUG_TRACE) console.log('[AF resolve] liga/season', { leagueId, season, dayYear });

  // 2) fixtures por rango (siempre intentamos primero)
  let fixtures = await listFixturesByRange({ from, to, leagueId, season }).catch(() => []);
  if (!fixtures.length && leagueId) {
    // algunos torneos exigen season explícita: intentar sin season también
    fixtures = await listFixturesByRange({ from, to, leagueId, season: null }).catch(() => []);
  }
  if (!fixtures.length) {
    // último intento amplio por fecha
    fixtures = await listFixturesByRange({ from, to }).catch(() => []);
  }

  if (DEBUG_TRACE) console.log('[AF resolve] fixtures count', fixtures.length);

  const pickFx = resolveFixtureFromList(fixtures, home, away);
  if (pickFx.ok) {
    const out = {
      ok: true,
      reason: 'FIXTURE_MATCH',
      confidence: pickFx.score,
      fixture_id: pickFx.fixture_id,
      league_id: pickFx.league_id,
      season: pickFx.season,
      homeId: pickFx.homeId,
      awayId: pickFx.awayId,
      home,
      away,
      liga,
    };
    if (DEBUG_TRACE) console.log('[AF resolve] OK via fixture', out);
    return out;
  }

  // 3) fallback por equipos
  const hId = await pickTeamId(home, { leagueId, season }).catch(() => null);
  const aId = await pickTeamId(away, { leagueId, season }).catch(() => null);

  if (hId && aId) {
    const out = {
      ok: true,
      reason: 'TEAMS_FALLBACK',
      confidence: null,
      fixture_id: null,
      league_id: leagueId || null,
      season: season || null,
      homeId: hId,
      awayId: aId,
      home,
      away,
      liga,
    };
    if (DEBUG_TRACE) console.log('[AF resolve] OK via teams', out);
    return out;
  }

  if (DEBUG_TRACE) console.warn('[AF resolve] null result', { pickFx, hId, aId });
  return null;
}

// También exportamos algunas utilidades por compat
async function searchFixturesByNames(home, away, { from, to, leagueId, season } = {}) {
  const fixtures = await listFixturesByRange({ from, to, leagueId, season }).catch(() => []);
  return resolveFixtureFromList(fixtures, home, away);
}

module.exports = {
  afApi,
  sim,
  pickTeamId,
  searchFixturesByNames,
  resolveFixtureFromList,
  resolveTeamsAndLeague,
};
