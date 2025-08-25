// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * API-FOOTBALL helpers y resolución de fixture por nombres.
 * - Sin listas fijas; normalización + similitud robusta.
 * - Umbral configurable vía ENV: MATCH_RESOLVE_CONFIDENCE (0.72 por defecto).
 * - Ponderación suave por liga y país si están disponibles en el candidato.
 */

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
if (!API_FOOTBALL_KEY) {
  console.error('af-resolver.cjs: falta API_FOOTBALL_KEY en el entorno');
}

const MATCH_RESOLVE_CONFIDENCE = (() => {
  const v = Number(process.env.MATCH_RESOLVE_CONFIDENCE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.72;
})();

const MATCH_LEAGUE_WEIGHT = (() => {
  const v = Number(process.env.MATCH_LEAGUE_WEIGHT);
  return Number.isFinite(v) ? v : 0.10; // peso suave
})();

const MATCH_COUNTRY_WEIGHT = (() => {
  const v = Number(process.env.MATCH_COUNTRY_WEIGHT);
  return Number.isFinite(v) ? v : 0.05; // peso muy suave
})();

const AF_BASE = 'https://v3.football.api-sports.io';

// --- Utils de normalización y similitud (sin dependencias) ---

const _accentMap = {
  á:'a', é:'e', í:'i', ó:'o', ú:'u', ü:'u', ñ:'n',
  Á:'a', É:'e', Í:'i', Ó:'o', Ú:'u', Ü:'u', Ñ:'n',
  ã:'a', å:'a', â:'a', ä:'a', à:'a', ç:'c',
  Ã:'a', Å:'a', Â:'a', Ä:'a', À:'a', Ç:'c',
  ô:'o', ö:'o', ò:'o', Ô:'o', Ö:'o', Ò:'o',
  ê:'e', ë:'e', è:'e', Ê:'e', Ë:'e', È:'e'
};

function stripAccents(s) {
  return (s || '')
    .replace(/[^\u0000-\u007E]/g, ch => _accentMap[ch] || ch);
}

function normalizeName(s) {
  if (!s) return '';
  let x = stripAccents(String(s).toLowerCase());
  // quitar ruido común
  x = x
    .replace(/[\.\,\-_:;\/\\'’`´]+/g, ' ')
    .replace(/\b(fc|cf|ac|sc|afc|u\d{1,2}|sub-\d{1,2})\b/g, ' ')
    .replace(/\b(team|club|deportivo|atletico|sporting|united|city|inter|real)\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return x;
}

function tokenize(s) {
  return normalizeName(s).split(/\s+/).filter(Boolean);
}

// Levenshtein distance básico
function levenshtein(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );
      prev = tmp;
    }
  }
  return dp[n];
}

function ratio(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  if (!a && !b) return 1;
  const dist = levenshtein(a, b);
  const L = Math.max(a.length, b.length) || 1;
  return 1 - (dist / L);
}

function jaccardTokens(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uni = A.size + B.size - inter || 1;
  return inter / uni;
}

function nameSimilarity(a, b) {
  // mezcla robusta: tokens + ratio caracter
  const jt = jaccardTokens(a, b);
  const rt = ratio(a, b);
  // dar más peso a tokens (nombres de clubes se benefician de tokens)
  return 0.65 * jt + 0.35 * rt;
}

function leagueSimilarity(a, b) {
  if (!a || !b) return 0;
  return nameSimilarity(a, b);
}

function countrySimilarity(a, b) {
  if (!a || !b) return 0;
  return normalizeName(a) === normalizeName(b) ? 1 : 0;
}

// Distancia temporal (en minutos absolutos)
function minutesDiff(aISO, bISO) {
  try {
    const a = new Date(aISO).getTime();
    const b = new Date(bISO).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.abs(a - b) / 60000;
  } catch {
    return null;
  }
}

// --- API-Football thin client (por si se requiere en el futuro) ---

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
 * searchFixturesByNames (opcional): no lo usas directo hoy,
 * pero lo exponemos por si necesitas refinar búsquedas en otra etapa.
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

// Helper: /fixtures?search (texto) con ventana opcional y timezone=UTC
async function searchFixturesByText({ q, from, to }) {
  if (!q) return [];
  const params = { search: q, timezone: 'UTC' };
  if (from) params.from = from;
  if (to) params.to = to;
  try {
    const resp = await afApi('/fixtures', params);
    return Array.isArray(resp) ? resp : [];
  } catch (e) {
    if (process.env.AF_DEBUG) {
      console.warn('[AF_DEBUG] fixtures search error', e?.message || String(e));
    }
    return [];
  }
}

// Helper: unión por equipos (home ∪ away) con dedupe por fixture.id
async function searchFixturesByTeamsUnion({ home, away, from, to }) {
  const seen = new Set(), out = [];
  const add = (arr=[]) => { for (const fx of arr) { const id = fx?.fixture?.id; if (!id || seen.has(id)) continue; seen.add(id); out.push(fx); } };
  const runOne = async (q) => q ? await searchFixturesByText({ q, from, to }) : [];
  add(await runOne(home));
  add(await runOne(away));
  return out;
}

// Parche: combina fecha + búsqueda textual y usa tu selector canónico
async function patchedResolveTeamsAndLeague(evt = {}, opts = {}) {
  const DBG = !!(process.env.AF_DEBUG);
  const home = evt.home || evt.home_team || evt?.teams?.home?.name || '';
  const away = evt.away || evt.away_team || evt?.teams?.away?.name || '';
  const liga = evt.liga || evt.league || evt.league_name || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || evt.kickoff || null;

  const isoDay = (d) => { try { return new Date(d).toISOString().slice(0,10); } catch { return null; } };
  const dayUTC = commence ? isoDay(commence) : null;

  // 1) fixtures por fecha (UTC)
  let listByDate = [];
  try {
    if (dayUTC) {
      listByDate = await afApi('/fixtures', { date: dayUTC, timezone: 'UTC' });
      if (DBG) console.log('[AF_DEBUG] fixtures by date', { date: dayUTC, count: listByDate.length });
    }
  } catch (e) {
    if (DBG) console.warn('[AF_DEBUG] fixtures by date error', e?.message || String(e));
  }

  // 2) fixtures por texto: unión (home ∪ away) con ventana ±1 día
  let listBySearch = [];
  try {
    if (home || away) {
      const base = commence ? new Date(commence) : null;
      const from = base ? isoDay(new Date(base.getTime() - 24*60*60*1000)) : null;
      const to   = base ? isoDay(new Date(base.getTime() + 24*60*60*1000)) : null;
      listBySearch = await searchFixturesByTeamsUnion({ home, away, from, to });
      if (DBG) console.log('[AF_DEBUG] fixtures search union scanned', { from, to, count: listBySearch.length });
    }
  } catch (e) {
    if (DBG) console.warn('[AF_DEBUG] fixtures search union error', e?.message || String(e));
  }

  // 3) merge + dedupe
  const seen = new Set(), merged = [];
  for (const arr of [listByDate, listBySearch]) {
    for (const fx of (arr || [])) {
      const id = fx?.fixture?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(fx);
    }
  }
  if (DBG) console.log('[AF_DEBUG] merged fixtures', { fromDate: listByDate.length, fromSearch: listBySearch.length, merged: merged.length });
  if (!merged.length) { if (DBG) console.warn('[AF_DEBUG] NO_CANDIDATES', { home, away, liga, dayUTC }); return null; }

  // 4) selección canónica (ORDEN correcto)
  const partido = { home, away, liga, kickoff: commence };
  const picked = resolveFixtureFromList(partido, merged);
  if (!picked) { if (DBG) console.warn('[AF_DEBUG] NO_MATCH (below confidence or unsuitable)', { home, away, liga, dayUTC }); return null; }

  // 5) method segun origen
  const pid = picked.fixture_id;
  const inDate = listByDate.some(fx => fx?.fixture?.id === pid);
  const inSearch = listBySearch.some(fx => fx?.fixture?.id === pid);
  const method = inDate ? 'date' : (inSearch ? 'search' : 'mixed');

  const out = { ...picked, method };
  if (DBG) console.log('[AF_DEBUG] PICK', { method, fixture_id: out.fixture_id, confidence: out.confidence });
  return out;
}

// Override controlado de export
if (module && module.exports) {
  try { module.exports.resolveTeamsAndLeague = patchedResolveTeamsAndLeague; } catch(_) {}
}

// ==== END PUNTERX PATCH ====
