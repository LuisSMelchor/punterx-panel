// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolución de IDs contra API-FOOTBALL sin hardcodes:
 * - Liga/temporada vía /leagues?search=
 * - Fixtures del día (mejor exactitud) y fallback a /teams con league+season
 * - Similitud por tokens (sin alias fijos)
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const AF_DEBUG = String(process.env.DEBUG_TRACE || process.env.AF_DEBUG || '0') === '1';
const SIM_THR = (() => {
  const n = parseFloat(process.env.SIM_THR || '');
  return Number.isFinite(n) ? n : 0.60;
})();

/* ----------------------------- utils básicas ------------------------------ */

const BASE = 'https://v3.football.api-sports.io';

function isoDay(d) {
  // YYYY-MM-DD en UTC
  const x = new Date(d);
  if (Number.isNaN(+x)) return null;
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function tokenSet(str = '') {
  return new Set(
    normalizeTeamName(str)
      .split(' ')
      .filter(Boolean)
  );
}

function jaccard(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

function dice(aStr, bStr) {
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function sim(a, b) {
  if (!a || !b) return 0;
  const na = normalizeTeamName(a), nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return Math.max(jaccard(na, nb), dice(na, nb));
}

async function afFetch(pathAndQuery) {
  if (!API_FOOTBALL_KEY) return { ok: false, status: 401, response: [], results: 0, error: 'no_api_key' };
  const url = BASE + pathAndQuery;
  const _fetch = global.fetch || (await import('node-fetch')).default;
  const res = await _fetch(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  const results = j?.results ?? (Array.isArray(j?.response) ? j.response.length : 0);
  if (AF_DEBUG) console.log('[AF_DEBUG]', res.status, pathAndQuery, 'results=', results);
  return { ok: res.ok, status: res.status, ...(j || {}), response: j?.response || [] };
}

/* ----------------------- helpers de búsqueda AF --------------------------- */

async function findLeagueSeason(leagueHint, year) {
  if (!leagueHint) return { leagueId: null, leagueName: null, season: null };
  const q = `/leagues?search=${encodeURIComponent(leagueHint)}`;
  const L = await afFetch(q);
  const items = L.response || [];
  if (!items.length) return { leagueId: null, leagueName: null, season: null };

  // Selecciona la entrada cuya seasons contenga el año; si no hay, toma "current"; si no, la última
  let picked = null;
  for (const it of items) {
    const seasons = it?.seasons || [];
    if (year && seasons.some(s => String(s.year) === String(year))) { picked = it; break; }
    if (!year && seasons.some(s => s.current)) picked = picked || it;
    picked = picked || it;
  }
  if (!picked?.league?.id) return { leagueId: null, leagueName: null, season: null };

  const seasons = picked.seasons || [];
  const season = year
    ? (seasons.find(s => String(s.year) === String(year))?.year ?? seasons.find(s => s.current)?.year ?? seasons.at(-1)?.year ?? null)
    : (seasons.find(s => s.current)?.year ?? seasons.at(-1)?.year ?? null);

  return { leagueId: picked.league.id, leagueName: picked.league.name || null, season };
}

async function searchFixturesByDay({ leagueId, season, dayUTC }) {
  if (!leagueId || !dayUTC) return [];
  // El parámetro date limita a ese día en la zona dada
  const q = `/fixtures?league=${leagueId}&season=${season}&date=${dayUTC}&timezone=UTC`;
  const F = await afFetch(q);
  return F.response || [];
}

async function teamsSearch({ leagueId, season, q }) {
  // Busca equipos acotando por liga/temporada si se dispone
  const base = leagueId ? `/teams?league=${leagueId}${season ? `&season=${season}` : ''}&search=${encodeURIComponent(q)}`
                        : `/teams?search=${encodeURIComponent(q)}`;
  const T = await afFetch(base);
  return T.response || [];
}

/* --------------------------- API pública ---------------------------------- */

/**
 * Intenta obtener teamId combinando fixtures del día y fallback por /teams.
 * No devuelve hardcodes; todo sale de la API.
 */
async function pickTeamId(_afApiIgnored, rawName, { leagueHint, commence } = {}) {
  const name = String(rawName || '').trim();
  if (!name) return null;

  const dayUTC = commence ? isoDay(commence) : null;
  const year = commence ? new Date(commence).getUTCFullYear() : null;

  // 1) Liga/temporada (si hay hint)
  const { leagueId, season } = await findLeagueSeason(leagueHint || null, year);

  // 2) Fallback directo /teams con/ sin liga
  const candidates = await teamsSearch({ leagueId, season, q: name });
  let best = { id: null, score: -1, name: null };
  for (const it of candidates) {
    const tname = it?.team?.name || '';
    const score = sim(name, tname);
    if (score > best.score) best = { id: it?.team?.id || null, score, name: tname };
  }
  if (AF_DEBUG) console.log('[AF_DEBUG] pickTeamId', { leagueId, season, q: name, best });

  if (best.id && best.score >= SIM_THR) return best.id;
  return null;
}

/**
 * Intenta resolver fixture y/o teamIds:
 *  - Primero por fixtures del día (si hay commence + liga)
 *  - Si no, resuelve teamIds por /teams y devuelve lo que consiga
 */
async function resolveTeamsAndLeague(evt = {}, opts = {}) {
  try {
    const home = evt.home || evt.home_team || evt?.teams?.home?.name || '';
    const away = evt.away || evt.away_team || evt?.teams?.away?.name || '';
    const leagueHint = (opts.leagueHint || evt.liga || evt.league || evt.league_name || evt.leagueName || '').trim();
    const commence = opts.commence || evt.commence || evt.commence_time || evt.commenceTime || null;

    const normH = normalizeTeamName(home);
    const normA = normalizeTeamName(away);
    const dayUTC = commence ? isoDay(commence) : null;
    const year = commence ? new Date(commence).getUTCFullYear() : null;

    if (AF_DEBUG) console.log('[AF_DEBUG] resolve start', { home, away, leagueHint, dayUTC, SIM_THR });

    // Liga/temporada
    const { leagueId, leagueName, season } = await findLeagueSeason(leagueHint || null, year);

    // 1) Fixtures del día (preciso y rápido)
    let fixturePick = null;
    let fChecked = 0;
    if (leagueId && dayUTC) {
      const fixtures = await searchFixturesByDay({ leagueId, season, dayUTC });
      fChecked = fixtures.length;

      let best = { fixture_id: null, homeId: null, awayId: null, score: -1, pair: null };
      for (const f of fixtures) {
        const fh = f?.teams?.home?.name || '';
        const fa = f?.teams?.away?.name || '';
        // compara en orden y cruzado
        const s1 = Math.min(sim(home, fh), sim(away, fa));
        const s2 = Math.min(sim(home, fa), sim(away, fh));
        const score = Math.max(s1, s2);
        if (score > best.score) {
          best = {
            fixture_id: f?.fixture?.id || null,
            homeId: s1 >= s2 ? (f?.teams?.home?.id || null) : (f?.teams?.away?.id || null),
            awayId: s1 >= s2 ? (f?.teams?.away?.id || null) : (f?.teams?.home?.id || null),
            score,
            pair: { fh, fa, s1, s2 }
          };
        }
      }
      if (AF_DEBUG) console.log('[AF_DEBUG] fixtures scanned', { count: fChecked, best: best.score });

      if (best.fixture_id && best.score >= SIM_THR) {
        fixturePick = best;
      }
    }

    // 2) Si no se encontró fixture suficientemente parecido, intenta /teams
    let homeId = fixturePick?.homeId || null;
    let awayId = fixturePick?.awayId || null;

    if (!homeId) {
      homeId = await pickTeamId(null, home, { leagueHint, commence });
    }
    if (!awayId) {
      awayId = await pickTeamId(null, away, { leagueHint, commence });
    }

    const out = {
      ok: Boolean(fixturePick?.fixture_id || (homeId && awayId)),
      method: fixturePick ? 'fixtures' : ((homeId && awayId) ? 'teams' : 'none'),
      fixture_id: fixturePick?.fixture_id || null,
      confidence: fixturePick?.score ?? (homeId && awayId ? Math.min(sim(home, String(homeId)), sim(away, String(awayId))) : null),
      home, away,
      liga: leagueName || (leagueHint || null),
      league_id: leagueId || null,
      season: season || null,
      homeId: homeId || null,
      awayId: awayId || null,
      reason: (!fixturePick && !(homeId && awayId)) ? (API_FOOTBALL_KEY ? 'not_found' : 'no_api_key') : null,
      debug: AF_DEBUG ? {
        normH, normA, SIM_THR,
        searched: { leagueHint: leagueHint || null, leagueId: leagueId || null, season: season || null, dayUTC: dayUTC || null },
        fixturesChecked: fChecked,
        fixtureBest: fixturePick?.pair || null
      } : undefined
    };

    if (AF_DEBUG) console.log('[AF_DEBUG] resolve done', { ok: out.ok, method: out.method, fixture_id: out.fixture_id, homeId: out.homeId, awayId: out.awayId });
    return out;
  } catch (e) {
    if (AF_DEBUG) console.warn('[AF_DEBUG] resolver error', e?.message || e);
    return { ok: false, reason: e?.message || String(e) };
  }
}


/**
 * Wrapper canónico: NO usa alias ni nombres fijos.
 * Busca por nombres (normalizados internamente por el propio módulo) y
 * usa el selector ya existente para elegir el fixture correcto.
 */
async function resolveTeamsAndLeague(evt = {}) {
  // Entradas
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const liga = evt.liga || evt.league || evt.league_name || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || evt.kickoff || null;

  // Utilidad local
  const isoDay = (d) => { try { return new Date(d).toISOString().slice(0,10); } catch(_) { return null; } };
  const dayUTC = commence ? isoDay(commence) : null;

  // 1) Lista por fecha
  let listByDate = [];
  try {
    if (dayUTC) {
      listByDate = await afApi('/fixtures', { date: dayUTC, timezone: 'UTC' });
      if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
        console.log('[AF_DEBUG] fixtures by date', { date: dayUTC, count: listByDate.length });
      }
    }
  } catch (e) {
    if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
      console.warn('[AF_DEBUG] fixtures by date error', e && e.message || String(e));
    }
  }

  // 2) Lista por búsqueda textual (±1 día)
  let listBySearch = [];
  try {
    if (home && away) {
      const base = commence ? new Date(commence) : null;
      const from = base ? isoDay(new Date(base.getTime() - 24*60*60*1000)) : null;
      const to   = base ? isoDay(new Date(base.getTime() + 24*60*60*1000)) : null;
      const q = `${home} ${away}`.trim();
      listBySearch = await searchFixturesByText({ q, from, to });
      if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
        console.log('[AF_DEBUG] fixtures search scanned', { from, to, count: listBySearch.length });
      }
    }
  } catch (e) {
    if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
      console.warn('[AF_DEBUG] fixtures search error', e && e.message || String(e));
    }
  }

  // 3) Merge + dedupe por fixture.id
  const seen = new Set();
  const merged = [];
  for (const arr of [listByDate, listBySearch]) {
    for (const fx of (arr || [])) {
      const id = fx && fx.fixture && fx.fixture.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(fx);
    }
  }
  if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
    console.log('[AF_DEBUG] merged fixtures', { count: merged.length });
  }

  // 4) Selección final con tu selector (ORDEN CORRECTO: partido, lista)
  const partido = { home, away, liga, kickoff: commence };
  const picked = resolveFixtureFromList(partido, merged);

  // 5) Resultado
  return picked || null;
}) {
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const liga = evt.liga || evt.league || evt.league_name || '';

  // Hints opcionales (no obligatorios)
  const commence = evt.commence || evt.commence_time || evt.commenceTime || null;

  // 1) Buscar lista de posibles fixtures por nombres
  const list = await searchFixturesByNames(home, away, { leagueHint: liga, commence, ...opts });

  // 2) Resolver el mejor fixture de esa lista
  return resolveFixtureFromList(list, { home, away, liga, commence, ...opts });
}


/**
 * Busca fixtures por texto (home/away) con ventana opcional.
 * /fixtures?search=<q>&from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=UTC
 */
async function searchFixturesByText({ q, from, to }) {
  if (!q) return [];
  const params = {};
  params.search = q;
  if (from) params.from = from;
  if (to) params.to = to;
  params.timezone = 'UTC';
  // Reutilizamos afApi para construir query y validar response
  try {
    const resp = await afApi('/fixtures', params);
    return Array.isArray(resp) ? resp : [];
  } catch (e) {
    if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
      console.warn('[AF_DEBUG] fixtures search error', e && e.message || String(e));
    }
    return [];
  }
}

module.exports = { afApi, searchFixturesByNames, resolveFixtureFromList, resolveTeamsAndLeague, sim, pickTeamId };


/** Similaridad tipo Dice (bigrams) sobre strings normalizados */
function sim(a = '', b = '') {
  const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  const grams = (t) => { const g=new Map(); for(let i=0;i<t.length-1;i++){ const bg=t.slice(i,i+2); g.set(bg,(g.get(bg)||0)+1);} return g; };
  const GA = grams(A), GB = grams(B);
  let overlap = 0;
  for (const [bg, cntA] of GA) {
    const cntB = GB.get(bg) || 0;
    overlap += Math.min(cntA, cntB);
  }
  const sizeA = Array.from(GA.values()).reduce((a,b)=>a+b,0);
  const sizeB = Array.from(GB.values()).reduce((a,b)=>a+b,0);
  return sizeA+sizeB ? (2*overlap)/(sizeA+sizeB) : 0;
}


/**
 * pickTeamId(afApi, name): intenta delegar en afApi si existe; si no, null.
 * NO hace fetch ni requiere API_KEY en "require-time".
 */
function pickTeamId(afApi, name) {
  if (!name) return null;
  try {
    if (afApi && typeof afApi.pickTeamId === 'function') {
      return afApi.pickTeamId(name) ?? null;
    }
  } catch(_) {}
  return null;
}
