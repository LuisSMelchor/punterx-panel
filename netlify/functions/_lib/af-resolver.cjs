// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolución robusta sin hardcode:
 * 1) Si hay commence => /fixtures?date=YYYY-MM-DD (+leagueId si se puede mapear) y matcheo por similitud.
 * 2) Fallback => /teams?search= para cada lado y similitud.
 * 3) Sin listas fijas ni alias quemados.
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

// ====== Config/consts ======
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const BASE_URL = 'https://v3.football.api-sports.io';

// Umbrales (puedes ajustar por ENV)
const SIM_THR = (() => {
  const n = parseFloat(process.env.SIM_THR || '');
  return Number.isFinite(n) ? n : 0.75;
})();

// ====== Utils de normalización/similitud ======
function normText(t = '') {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dice-bigrams sobre texto normalizado (más estable que tokens sueltos) */
function sim(a = '', b = '') {
  const A = normText(a), B = normText(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const grams = (t) => {
    const m = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const bg = t.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };
  const GA = grams(A), GB = grams(B);
  let overlap = 0, sizeA = 0, sizeB = 0;
  for (const v of GA.values()) sizeA += v;
  for (const v of GB.values()) sizeB += v;
  for (const [bg, cntA] of GA) overlap += Math.min(cntA, GB.get(bg) || 0);
  return (sizeA + sizeB) ? (2 * overlap) / (sizeA + sizeB) : 0;
}

// ====== Cliente simple API-FOOTBALL ======
async function afApi(path, params = {}) {
  if (!API_FOOTBALL_KEY) {
    console.warn('af-resolver.cjs: falta API_FOOTBALL_KEY en el entorno');
  }
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
  const _fetch = global.fetch || (await import('node-fetch')).default;
  const res = await _fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`AF ${path} ${res.status} ${txt && ':: ' + txt.slice(0, 200)}`);
  }
  return res.json();
}

// ====== Liga: mapear pista textual a leagueId/season ======
async function resolveLeagueId(leagueHint, commence) {
  if (!leagueHint) return { leagueId: null, season: null };
  const year = commence ? new Date(commence).getUTCFullYear() : null;

  const j = await afApi('/leagues', { search: leagueHint }).catch(() => null);
  const list = j && j.response || [];
  if (!list.length) return { leagueId: null, season: null };

  // Elige la liga cuya seasons incluya el año; si no hay commence, prioriza current.
  let best = null;
  for (const it of list) {
    const seasons = it.seasons || [];
    if (year) {
      if (seasons.some(s => String(s.year) === String(year))) { best = it; break; }
    } else {
      if (seasons.some(s => s.current)) { best = it; break; }
      best = best || it;
    }
  }
  if (!best || !best.league || !best.league.id) return { leagueId: null, season: null };

  const seasons = best.seasons || [];
  const season = year
    ? (seasons.find(s => String(s.year) === String(year))?.year)
    : (seasons.find(s => s.current)?.year || seasons.at(-1)?.year || null);

  return { leagueId: best.league.id, season: season || null };
}

// ====== 1) Buscar fixture del día por similitud (ideal) ======
async function findTeamsFromFixturesByDate({ home, away, leagueHint, commence, simThr }) {
  if (!commence) return null;
  const d = new Date(commence);
  if (Number.isNaN(+d)) return null;

  const yyyy_mm_dd = d.toISOString().slice(0, 10);
  let leagueId = null, season = null;

  // Si hay pista de liga, intenta mapearla a ID+season
  if (leagueHint) {
    const mapped = await resolveLeagueId(leagueHint, commence).catch(() => ({ leagueId: null, season: null }));
    leagueId = mapped.leagueId; season = mapped.season;
  }

  // /fixtures?date=YYYY-MM-DD [&league=ID][&season=YYYY]
  const params = { date: yyyy_mm_dd };
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;

  const j = await afApi('/fixtures', params).catch(() => null);
  const arr = j && j.response || [];
  if (!arr.length) return null;

  const H = normalizeTeamName(home);
  const A = normalizeTeamName(away);

  let best = null;
  for (const fx of arr) {
    const hName = fx?.teams?.home?.name || '';
    const aName = fx?.teams?.away?.name || '';
    const score = Math.min(sim(H, hName), sim(A, aName));
    if (!best || score > best.score) {
      best = {
        score,
        fixture_id: fx?.fixture?.id || null,
        homeId: fx?.teams?.home?.id || null,
        awayId: fx?.teams?.away?.id || null,
        hName, aName
      };
    }
  }
  if (best && best.score >= (simThr ?? SIM_THR) && best.fixture_id && best.homeId && best.awayId) {
    return { ...best, via: 'fixtures' };
  }
  return null;
}

// ====== 2) Fallback: buscar equipos por nombre (sin liga fija) ======
async function searchTeams(q) {
  const j = await afApi('/teams', { search: q }).catch(() => null);
  const arr = j && j.response || [];
  return arr.map(x => x && x.team).filter(Boolean);
}

// pickTeamId: mantiene la firma pública (afApi, rawName, { leagueHint, commence })
async function pickTeamId(_afApi_unused, rawName, { leagueHint, commence } = {}) {
  const qRaw = String(rawName || '').trim();
  if (!qRaw) return null;

  // Si hay pista de liga, intentamos acotar por liga+season para mejorar precisión
  let leagueId = null, season = null;
  if (leagueHint) {
    const mapped = await resolveLeagueId(leagueHint, commence).catch(() => ({ leagueId: null, season: null }));
    leagueId = mapped.leagueId; season = mapped.season;
  }

  let j;
  if (leagueId) {
    j = await afApi('/teams', { league: leagueId, season: season || undefined, search: qRaw }).catch(() => null);
  } else {
    j = await afApi('/teams', { search: qRaw }).catch(() => null);
  }
  const candidates = j && j.response || [];
  if (!candidates.length) return null;

  const want = normalizeTeamName(qRaw);
  let bestId = null, bestScore = -1;
  for (const it of candidates) {
    const name = it?.team?.name || '';
    if (!name) continue;
    const score = sim(want, name);
    if (score > bestScore) {
      bestScore = score;
      bestId = it?.team?.id || null;
    }
  }
  if (bestScore < SIM_THR) return null;
  return bestId || null;
}

// ====== Compat: listado de fixtures por nombres (para flows existentes) ======
async function searchFixturesByNames(home, away, { leagueHint, commence } = {}) {
  // Reutilizamos la lógica de fixtures del día; si no hay commence, no promete nada
  const found = await findTeamsFromFixturesByDate({ home, away, leagueHint, commence, simThr: SIM_THR }).catch(() => null);
  return found ? [found] : [];
}

async function resolveFixtureFromList(list, { /* home, away, commence */ } = {}) {
  if (!Array.isArray(list) || !list.length) return null;
  // ya vienen con score; devuelve el mejor con fixture_id válido
  const best = list
    .filter(x => x && x.fixture_id && x.homeId && x.awayId)
    .sort((a, b) => (b.score - a.score))[0];
  return best || null;
}

// ====== Resolución principal usada por autopick ======
async function resolveTeamsAndLeague(evt = {}, opts = {}) {
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const leagueHint = evt.liga || evt.league || evt.league_name || evt.leagueName || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || null;

  const simThr = Number.isFinite(+opts.simThr) ? +opts.simThr : SIM_THR;

  // 1) Intento ideal: fixtures del día
  const byFx = await findTeamsFromFixturesByDate({ home, away, leagueHint, commence, simThr }).catch(() => null);
  if (byFx && byFx.fixture_id) {
    return {
      ok: true,
      reason: 'resolved-by-fixture-date',
      confidence: byFx.score,
      home, away, liga: leagueHint,
      teamIds: { homeId: byFx.homeId, awayId: byFx.awayId },
      fixture_id: byFx.fixture_id
    };
  }

  // 2) Fallback: teams search (sin hardcode)
  const [homeId, awayId] = await Promise.all([
    pickTeamId(afApi, home, { leagueHint, commence }),
    pickTeamId(afApi, away, { leagueHint, commence })
  ]);

  if (homeId && awayId) {
    // Con IDs, puedes intentar head-to-head del día para obtener fixture_id (si existiera)
    // NOTA: /fixtures/headtohead no acepta date exacta, así que no garantizamos el fixture.
    return {
      ok: true,
      reason: 'teams-search',
      confidence: null,
      home, away, liga: leagueHint,
      teamIds: { homeId, awayId },
      fixture_id: null
    };
  }

  return null;
}

module.exports = {
  afApi,
  searchFixturesByNames,
  resolveFixtureFromList,
  resolveTeamsAndLeague,
  sim,
  pickTeamId
};
