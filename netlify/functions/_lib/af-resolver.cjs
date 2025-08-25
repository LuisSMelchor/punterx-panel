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

async function afApi(path, params = {}) {
  // Nota: Node 20 ya tiene fetch global
  const url = new URL(AF_BASE + path);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_FOOTBALL_KEY,
      'x-rapidapi-key': API_FOOTBALL_KEY, // algunos proxies
      'accept': 'application/json'
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(()=> '');
    throw new Error(`AF HTTP ${res.status} ${res.statusText} :: ${url} :: ${body}`);
  }
  const json = await res.json();
  if (!json || !Array.isArray(json.response)) {
    throw new Error(`AF response malformado: ${url}`);
  }
  return json.response;
}

/**
 * Intenta resolver fixture y/o teamIds:
 *  - Primero por fixtures del día (si hay commence + liga)
 *  - Si no, resuelve teamIds por /teams y devuelve lo que consiga
 */
async function searchFixturesByNames({ dateISO, leagueId, season, timezone }) {
  const params = {};
  if (dateISO) params.date = dateISO.slice(0, 10);
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;
  if (timezone) params.timezone = timezone;
  // /fixtures por fecha/league/season
  return afApi('/fixtures', params);
}

/**
 * resolveFixtureFromList(partido, afList)
 * - partido: { home, away, liga?, pais?, kickoff? } (kickoff opcional para desempate)
 * - afList: lista de fixtures ya consultados (API-Football)
 * Retorna objeto con ids y metadatos del mejor match o null.
 */
function resolveFixtureFromList(partido, afList) {
  try {
    if (!afList || !Array.isArray(afList) || afList.length === 0) return null;

    const homeQ = partido?.home || partido?.equipos?.home || partido?.equipos?.local || '';
    const awayQ = partido?.away || partido?.equipos?.away || partido?.equipos?.visitante || '';
    const ligaQ = partido?.liga || partido?.league || '';
    const paisQ = partido?.pais || partido?.country || '';
    const kickoffQ = partido?.kickoff || partido?.commence_time || partido?.start_time || null;

    const nh = normalizeName(homeQ);
    const na = normalizeName(awayQ);

    const scored = [];

    for (const fx of afList) {
      const fh = fx?.teams?.home?.name || fx?.teams?.home?.common || fx?.teams?.home?.code || '';
      const fa = fx?.teams?.away?.name || fx?.teams?.away?.common || fx?.teams?.away?.code || '';
      const leagueName = fx?.league?.name || '';
      const country = fx?.league?.country || '';
      const fxKick = fx?.fixture?.date || null;

      // Similaridades por orientación correcta
      const sHome = nameSimilarity(fh, nh);
      const sAway = nameSimilarity(fa, na);
      const scoreDirect = (sHome + sAway) / 2;

      // Similaridad por swap (por si están invertidos)
      const sHomeSwap = nameSimilarity(fh, na);
      const sAwaySwap = nameSimilarity(fa, nh);
      const scoreSwap = (sHomeSwap + sAwaySwap) / 2;

      // Ponderaciones por liga/país (suaves)
      const sLeague = leagueSimilarity(leagueName, ligaQ);
      const sCountry = countrySimilarity(country, paisQ);

      // tomar el mejor de direct/swap y sumarle ligas/país
      let baseScore, swapped;
      if (scoreDirect >= scoreSwap) {
        baseScore = scoreDirect;
        swapped = false;
      } else {
        baseScore = scoreSwap;
        swapped = true;
      }

      let score = baseScore
        + MATCH_LEAGUE_WEIGHT * sLeague
        + MATCH_COUNTRY_WEIGHT * sCountry;

      // Pequeño bonus si existe kickoff cercano (<= 180 min)
      let timeBonus = 0;
      if (kickoffQ && fxKick) {
        const min = minutesDiff(kickoffQ, fxKick);
        if (min !== null) {
          // de 0 a 180 minutos: bonus lineal decreciente
          const clamped = Math.max(0, Math.min(180, min));
          timeBonus = (1 - (clamped / 180)) * 0.05; // máx +0.05 si es idéntico
          score += timeBonus;
        }
      }

      scored.push({
        fx, score, swapped, timeBonus,
        sHome, sAway, sHomeSwap, sAwaySwap, sLeague, sCountry
      });
    }

    // Ordenar por score desc. En empate, priorizar menor diferencia de hora.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ak = a.fx?.fixture?.date;
      const bk = b.fx?.fixture?.date;
      const da = kickoffQ && ak ? minutesDiff(kickoffQ, ak) : null;
      const db = kickoffQ && bk ? minutesDiff(kickoffQ, bk) : null;
      if (da !== null && db !== null && da !== db) return da - db;
      return 0;
    });

    const best = scored[0];
    if (!best) return null;

    // Decisión final por umbral
    if (best.score < MATCH_RESOLVE_CONFIDENCE) {
      // log educativo, sin romper
      console.warn(`[AF-RESOLVER] score<umbral → NO_MATCH`, {
        home: homeQ, away: awayQ, ligaQ, paisQ,
        best: {
          home: best.fx?.teams?.home?.name,
          away: best.fx?.teams?.away?.name,
          league: best.fx?.league?.name,
          country: best.fx?.league?.country,
          score: Number(best.score.toFixed(3)),
          swapped: best.swapped
        },
        umbral: MATCH_RESOLVE_CONFIDENCE
      });
      return null;
    }

    const fx = best.fx;
    return {
      fixture_id: fx?.fixture?.id,
      kickoff: fx?.fixture?.date,
      league_id: fx?.league?.id,
      league_name: fx?.league?.name,
      country: fx?.league?.country,
      home_id: fx?.teams?.home?.id,
      away_id: fx?.teams?.away?.id,
      swapped: best.swapped,
      confidence: Number(best.score.toFixed(3))
    };

  } catch (e) {
    console.error('resolveFixtureFromList error:', e && e.stack ? e.stack : String(e));
    return null;
  }
}


/**
 * Wrapper canónico: NO usa alias ni nombres fijos.
 * Busca por nombres (normalizados internamente por el propio módulo) y
 * usa el selector ya existente para elegir el fixture correcto.
 */
async function resolveTeamsAndLeague(evt = {}, opts = {}) {
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



// ==== PUNTERX PATCH (non-intrusive) ==== 

/**
 * Busca fixtures por texto (home/away) con ventana opcional.
 * /fixtures?search=<q>&from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=UTC
 */
async function searchFixturesByText({ q, from, to }) {
  if (!q) return [];
  const params = { search: q, timezone: 'UTC' };
  if (from) params.from = from;
  if (to) params.to = to;
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


/**
 * patchedResolveTeamsAndLeague: combina fixtures por fecha + búsqueda textual (±1d),
 * dedupe por fixture.id y delega selección a resolveFixtureFromList(partido, lista).
 * NO toca resolveFixtureFromList (respeta tu gate por MATCH_RESOLVE_CONFIDENCE).
 */
async function patchedResolveTeamsAndLeague(evt = {}, opts = {}) {
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const liga = evt.liga || evt.league || evt.league_name || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || evt.kickoff || null;

  const isoDay = (d) => { try { return new Date(d).toISOString().slice(0,10); } catch(_) { return null; } };
  const dayUTC = commence ? isoDay(commence) : null;

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

  // Merge + dedupe
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
    console.log('[AF_DEBUG] merged fixtures', { fromDate: listByDate.length, fromSearch: listBySearch.length, merged: merged.length });
  }
  if (!merged.length) {
    if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
      console.warn('[AF_DEBUG] NO_CANDIDATES after date+search', { home, away, liga, dayUTC });
    }
    return null;
  }

  const partido = { home, away, liga, kickoff: commence };
  const picked = resolveFixtureFromList(partido, merged);
  if (!picked) {
    if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
      console.warn('[AF_DEBUG] NO_MATCH (below confidence or not suitable)', { home, away, liga, dayUTC });
    }
    return null;
  }

  // method para trazabilidad
  const pid = picked.fixture_id;
  const inDate = (listByDate || []).some(fx => fx?.fixture?.id === pid);
  const inSearch = (listBySearch || []).some(fx => fx?.fixture?.id === pid);
  const method = inDate ? 'date' : (inSearch ? 'search' : 'mixed');

  const out = { ...picked, method };
  if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
    console.log('[AF_DEBUG] PICK', { method, fixture_id: out.fixture_id, confidence: out.confidence });
  }
  return out;
}

// Override seguro de la export
try {
  module.exports.resolveTeamsAndLeague = patchedResolveTeamsAndLeague;
  if (typeof AF_DEBUG !== 'undefined' && AF_DEBUG) {
    console.log('[AF_DEBUG] resolveTeamsAndLeague overridden by patchedResolveTeamsAndLeague');
  }
} catch(_) {}


