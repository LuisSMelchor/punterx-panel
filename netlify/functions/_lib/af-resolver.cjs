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

module.exports = { afApi, searchFixturesByNames, resolveFixtureFromList, resolveTeamsAndLeague: resolveTeamsAndLeague, sim, pickTeamId };


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
  

if (!merged.length) {
  if (DBG) console.warn('[AF_DEBUG] NO_CANDIDATES', { home, away, liga, dayUTC });

  // --- H2H FALLBACK (antes de devolver null) ---
  try {
    const base = commence ? new Date(commence) : null;
    const from = base ? new Date(base.getTime() - 2*24*60*60*1000).toISOString().slice(0,10) : null;
    const to   = base ? new Date(base.getTime() + 2*24*60*60*1000).toISOString().slice(0,10) : null;

    // teamIds vía /teams?search
    const tHome = (await teamsSearch({ q: home }))?.[0]?.team?.id || null;
    const tAway = (await teamsSearch({ q: away }))?.[0]?.team?.id || null;

      /* H2H RE-TRY WITH LEAGUE/SEASON */
      if (!(tHome && tAway)) {
        const { leagueId, season } = await getLeagueIdAndSeasonByName(liga);
        if (process.env.AF_DEBUG) console.log('[AF_DEBUG] league hint', { liga, leagueId, season });
        try {
          let homeCandidates = await teamsSearch({ leagueId, season, q: home });
          let awayCandidates = await teamsSearch({ leagueId, season, q: away });
          const pickedHome = pickBestTeamIdByName(homeCandidates, home);
          const pickedAway = pickBestTeamIdByName(awayCandidates, away);
          if (!tHome && pickedHome) { /* override local */ }
          if (!tAway && pickedAway) { /* override local */ }
          const _tHome = tHome || pickedHome || null;
          const _tAway = tAway || pickedAway || null;
          if (_tHome && _tAway) {
            const listH2H2 = await searchFixturesByH2H({ homeId: _tHome, awayId: _tAway, from, to });
            if (DBG) console.log('[AF_DEBUG] h2h fixtures scanned (league-bound)', { from, to, count: listH2H2.length });
            if (listH2H2.length) {
              const partidoH2H2 = { home, away, liga, kickoff: commence };
              const pickedH2H2 = resolveFixtureFromList(partidoH2H2, listH2H2);
              if (pickedH2H2) {
                const out2 = { ...pickedH2H2, method: 'h2h' };
                if (DBG) console.log('[AF_DEBUG] PICK(H2H)', { fixture_id: out2.fixture_id, confidence: out2.confidence });
                return out2;
              }
            }
          }
        } catch (e) {
          if (DBG) console.warn('[AF_DEBUG] h2h league-bound error', e?.message || String(e));
        }
      }

    if (tHome && tAway) {
      const listH2H = await searchFixturesByH2H({ homeId: tHome, awayId: tAway, from, to });
      if (DBG) console.log('[AF_DEBUG] h2h fixtures scanned', { from, to, count: listH2H.length });
      if (listH2H.length) {
        const partidoH2H = { home, away, liga, kickoff: commence };
        const pickedH2H = resolveFixtureFromList(partidoH2H, listH2H);
        if (pickedH2H) {
          const out = { ...pickedH2H, method: 'h2h' };
          if (DBG) console.log('[AF_DEBUG] PICK(H2H)', { fixture_id: out.fixture_id, confidence: out.confidence });
          return out;
        }
      }
    }
  } catch (e) {
    if (DBG) console.warn('[AF_DEBUG] h2h fallback error', e?.message || String(e));
  }
  // --- FIN H2H FALLBACK ---

  return null;
}



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


/** AF /teams?search (liga/temporada opcionales) */
async function teamsSearch({ leagueId, season, q }) {
  if (!q) return [];
  const params = { search: q };
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;
  try {
    const resp = await afApi('/teams', params);
    return Array.isArray(resp) ? resp : [];
  } catch (e) {
    if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] teams search error', e?.message || String(e));
    return [];
  }
}


/** Busca un teamId por nombre (opcionalmente con liga/season) */
async function getTeamIdByName(name, { leagueId, season } = {}) {
  if (!name) return null;
  const resp = await teamsSearch({ leagueId, season, q: name });
  // Tomamos el primero; el selector final decide el fixture luego.
  return (resp[0] && resp[0].team && resp[0].team.id) || null;
}


/** AF /fixtures/headtohead?h2h=homeId-awayId&from&to&timezone=UTC */
async function h2hFixturesByIds(homeId, awayId, { from, to } = {}) {
  if (!homeId || !awayId) return [];
  const params = { h2h: `${homeId}-${awayId}`, timezone: 'UTC' };
  if (from) params.from = from;
  if (to) params.to = to;
  try {
    const resp = await afApi('/fixtures/headtohead', params);
    return Array.isArray(resp) ? resp : [];
  } catch (e) {
    if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] h2h error', e?.message || String(e));
    return [];
  }
}



/** AF /fixtures/headtohead con ventana opcional */
async function searchFixturesByH2H({ homeId, awayId, from, to }) {
  if (!homeId || !awayId) return [];
  const params = { h2h: `${homeId}-${awayId}`, timezone: 'UTC' };
  if (from) params.from = from;
  if (to) params.to = to;
  try {
    const resp = await afApi('/fixtures/headtohead', params);
    return Array.isArray(resp) ? resp : [];
  } catch (e) {
    if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] h2h error', e?.message || String(e));
    return [];
  }
}



/** AF /leagues?search -> retorna {leagueId, season} (temporada current=true si existe) */
async function getLeagueIdAndSeasonByName(leagueName) {
  if (!leagueName) return { leagueId: null, season: null };
  try {
    const resp = await afApi('/leagues', { search: leagueName });
    if (!Array.isArray(resp) || !resp.length) return { leagueId: null, season: null };
    // Elegimos la liga con mayor similitud por nombre
    const scored = resp.map(x => ({
      leagueId: x?.league?.id ?? null,
      leagueName: x?.league?.name ?? '',
      seasons: Array.isArray(x?.seasons) ? x.seasons : [],
      score: (typeof sim === 'function') ? sim(x?.league?.name ?? '', leagueName) : 0
    })).sort((a,b) => b.score - a.score);
    const top = scored[0];
    if (!top?.leagueId) return { leagueId: null, season: null };
    // temporada: la current=true si existe; si no, la más reciente
    let season = null;
    const currents = top.seasons.filter(s => s?.current);
    if (currents.length) season = currents[0]?.year ?? null;
    if (!season && top.seasons.length) {
      const sorted = [...top.seasons].sort((a,b) => (b?.year ?? 0) - (a?.year ?? 0));
      season = sorted[0]?.year ?? null;
    }
    return { leagueId: top.leagueId, season };
  } catch (e) {
    if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] leagues search error', e?.message || String(e));
    return { leagueId: null, season: null };
  }
}


/** Elige el team.id con mayor similitud a 'name' (umbral SIM_THR o 0.7 por defecto) */
function pickBestTeamIdByName(candidates = [], name) {
  const thr = Number(process.env.SIM_THR ?? 0.7);
  const scored = candidates.map(c => {
    const t = c?.team;
    const n = t?.name || t?.common || t?.code || '';
    return { id: t?.id ?? null, score: (typeof sim === 'function') ? sim(n, name) : 0, name: n };
  }).filter(x => x.id);
  scored.sort((a,b) => b.score - a.score);
  const top = scored[0];
  if (process.env.AF_DEBUG) console.log('[AF_DEBUG] team pick', { q: name, best: top?.name, score: top?.score });
  return (top && top.score >= thr) ? top.id : null;
}


// ==== PUNTERX PATCH: strong league & team helpers (idempotent) ====

/** Normaliza el texto de equipo: quita sufijos/ruido comunes */
function cleanTeamQuery(q='') {
  return String(q)
    .replace(/\b(FC|CF|SC|AC|CD|UD|FK|SK)\b/gi,'')
    .replace(/\b(Club|Sport|Deportivo|Athletic|Atletico|United|City|Sporting|Real)\b/gi,'')
    .replace(/\s+/g,' ')
    .trim();
}

/** Re-declaración: AF /teams con fallbacks (search/name + query limpia) */
async function teamsSearch({ leagueId, season, q }) {
  if (!q) return [];
  const out = [];
  const tries = [];

  // tries en orden decreciente de “amplitud”
  tries.push({ search: q });
  tries.push({ name: q });

  const qClean = cleanTeamQuery(q);
  if (qClean && qClean !== q) {
    tries.push({ search: qClean });
    tries.push({ name: qClean });
  }

  for (const base of tries) {
    const params = { ...base };
    if (leagueId) params.league = leagueId;
    if (season) params.season = season;
    try {
      const resp = await afApi('/teams', params);
      const arr = Array.isArray(resp) ? resp : [];
      if (process.env.AF_DEBUG) console.log('[AF_DEBUG] teamsSearch try', { base, leagueId, season, found: arr.length });
      if (arr.length) return arr;  // primer acierto
    } catch (e) {
      if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] teams search error', { base, msg: e?.message || String(e) });
    }
  }
  return out;
}

/** Re-declaración: /leagues robusta. Devuelve {leagueId, season} */
async function getLeagueIdAndSeasonByName(leagueName) {
  if (!leagueName) return { leagueId: null, season: null };

  const tries = [];
  // directos
  tries.push({ search: leagueName });
  tries.push({ name: leagueName });
  // alias MLS
  if (/major\s+league\s+soccer/i.test(leagueName) || /\bMLS\b/i.test(leagueName)) {
    tries.push({ name: 'MLS' });
    tries.push({ search: 'MLS' });
  }
  // con país
  tries.push({ search: leagueName, country: 'USA' });
  tries.push({ name: leagueName, country: 'USA' });

  for (const params of tries) {
    try {
      const resp = await afApi('/leagues', params);
      const arr = Array.isArray(resp) ? resp : [];
      if (process.env.AF_DEBUG) console.log('[AF_DEBUG] leagues try', { params, found: arr.length });
      if (!arr.length) continue;

      const scored = arr.map(x => ({
        leagueId: x?.league?.id ?? null,
        leagueName: x?.league?.name ?? '',
        country: x?.country?.name ?? x?.league?.country ?? '',
        seasons: Array.isArray(x?.seasons) ? x.seasons : [],
        score: (typeof sim === 'function') ? sim(x?.league?.name ?? '', leagueName) : 0
      })).sort((a,b) => b.score - a.score);

      const top = scored[0];
      if (!top?.leagueId) continue;

      // temporada: current=true o más reciente
      let season = null;
      const currents = top.seasons.filter(s => s?.current);
      if (currents.length) season = currents[0]?.year ?? null;
      if (!season && top.seasons.length) {
        const sorted = [...top.seasons].sort((a,b) => (b?.year ?? 0) - (a?.year ?? 0));
        season = sorted[0]?.year ?? null;
      }
      if (process.env.AF_DEBUG) console.log('[AF_DEBUG] leagues pick', { leagueId: top.leagueId, season, name: top.leagueName, score: Number(top.score?.toFixed?.(3) ?? top.score) });
      return { leagueId: top.leagueId, season };
    } catch (e) {
      if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] leagues search error', { params, msg: e?.message || String(e) });
    }
  }
  return { leagueId: null, season: null };
}


// ==== PUNTERX PATCH: MLS hint + final override (idempotent) ====

const MLS_LEAGUE_ID = 253;

/** Heurística de temporada: año UTC del commence (fallback: año actual) */
function guessSeasonFromCommence(commence) {
  try {
    if (commence) return new Date(commence).getUTCFullYear();
  } catch(_) {}
  return new Date().getUTCFullYear();
}

/** Detección robusta de MLS y obtención de leagueId/season */
async function robustLeagueHint(liga, commence) {
  // 1) Si ya tenemos helper avanzado, úsalo
  if (typeof getLeagueIdAndSeasonByName === 'function') {
    const r = await getLeagueIdAndSeasonByName(liga);
    if (r?.leagueId) return r;
  }
  // 2) Heurística MLS
  if (/\bMLS\b/i.test(liga) || /major\s+league\s+soccer/i.test(liga)) {
    return { leagueId: MLS_LEAGUE_ID, season: guessSeasonFromCommence(commence) };
  }
  return { leagueId: null, season: null };
}

/** teamsSearch con liga/temporada si las tenemos (mantiene el que ya exista, pero lo envuelve) */
async function teamsSearchWithHint({ q, liga, commence }) {
  if (!q) return [];
  let leagueId = null, season = null;
  try {
    const hint = await robustLeagueHint(liga, commence);
    leagueId = hint.leagueId || null;
    season = hint.season || null;
  } catch(_) {}
  // Si existe teamsSearch (ya definido arriba), lo reutilizamos
  if (typeof teamsSearch === 'function') {
    return teamsSearch({ leagueId, season, q });
  }
  // Fallback súper simple si no existiera
  const params = { search: q };
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;
  return afApi('/teams', params);
}

/** H2H fuerte: dado home/away y liga, intenta ±7d con IDs de equipo dentro de la liga/temporada */
async function h2hWithLeague({ home, away, liga, commence }) {
  try {
    const base = commence ? new Date(commence) : null;
    const iso = (d) => new Date(d).toISOString().slice(0,10);
    const from = base ? iso(new Date(base.getTime() - 7*24*60*60*1000)) : null;
    const to   = base ? iso(new Date(base.getTime() + 7*24*60*60*1000)) : null;

    const tHome = (await teamsSearchWithHint({ q: home, liga, commence }))?.[0]?.team?.id || null;
    const tAway = (await teamsSearchWithHint({ q: away, liga, commence }))?.[0]?.team?.id || null;

    if (process.env.AF_DEBUG) {
      console.log('[AF_DEBUG] H2H hint', { liga, from, to, tHome, tAway });
    }

    if (!tHome || !tAway) return [];

    // Si tenemos helper H2H ya agregado, úsalo
    if (typeof searchFixturesByH2H === 'function') {
      return await searchFixturesByH2H({ homeId: tHome, awayId: tAway, from, to });
    }

    // Fallback genérico H2H por API
    const params = { h2h: `${tHome}-${tAway}` };
    if (from) params.from = from;
    if (to) params.to = to;
    params.timezone = 'UTC';
    try {
      const resp = await afApi('/fixtures', params);
      return Array.isArray(resp) ? resp : [];
    } catch(e) {
      if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] h2h fallback error', e?.message || String(e));
      return [];
    }
  } catch(e) {
    if (process.env.AF_DEBUG) console.warn('[AF_DEBUG] h2hWithLeague error', e?.message || String(e));
    return [];
  }
}

/** Último override: intenta el resolver parcheado actual; si devuelve null → H2H con liga forzada */
async function patchedResolveTeamsAndLeague_FINAL(evt = {}, opts = {}) {
  const DBG = !!process.env.AF_DEBUG;
  try {
    if (typeof patchedResolveTeamsAndLeague === 'function') {
      const first = await patchedResolveTeamsAndLeague(evt, opts);
      if (first) return first;
    }
  } catch(e) {
    if (DBG) console.warn('[AF_DEBUG] patchedResolveTeamsAndLeague(primary) error', e?.message || String(e));
  }

  const home = evt.home || evt.home_team || evt?.teams?.home?.name || '';
  const away = evt.away || evt.away_team || evt?.teams?.away?.name || '';
  const liga = evt.liga || evt.league || evt.league_name || '';
  const commence = evt.commence || evt.commence_time || evt.commenceTime || evt.kickoff || null;

  // Intento H2H con liga/temporada forzada (MLS u otra si getLeagueId... funciona)
  try {
    const list = await h2hWithLeague({ home, away, liga, commence });
    if (DBG) console.log('[AF_DEBUG] h2hWithLeague fixtures', { count: list.length });
    if (list.length && typeof resolveFixtureFromList === 'function') {
      const picked = resolveFixtureFromList({ home, away, liga, kickoff: commence }, list);
      if (picked) {
        const out = { ...picked, method: 'h2h' };
        if (DBG) console.log('[AF_DEBUG] PICK(H2H-final)', { fixture_id: out.fixture_id, confidence: out.confidence });
        return out;
      }
    }
  } catch(e) {
    if (DBG) console.warn('[AF_DEBUG] h2hWithLeague wrapper error', e?.message || String(e));
  }

  if (DBG) console.warn('[AF_DEBUG] FINAL NULL after all strategies', { home, away, liga, commence });
  return null;
}

// Override explícito (última palabra se queda)
/* === S2.7 Debouncer wrapper (final-safe) === */
try {
  if (module && module.exports && typeof module.exports.resolveTeamsAndLeague === 'function') {
    const _orig = module.exports.resolveTeamsAndLeague;
    const _afDupe = new Map();
    function _mkDupeKey(evt) {
      const h = (evt?.home || '').toLowerCase().trim();
      const a = (evt?.away || '').toLowerCase().trim();
      const l = (evt?.league || '').toLowerCase().trim();
      const d = evt?.commence ? new Date(evt.commence).toISOString().slice(0,10) : '';
      return [h,a,l,d].join('|');
    }
    module.exports.resolveTeamsAndLeague = async function debouncedResolve(evt, opts = {}) {
      const dupeKey = _mkDupeKey(evt);
      if (_afDupe.has(dupeKey)) {
        if (Number(process.env.AF_DEBUG)) console.log('[AF_DEBUG] duplicate', { dupeKey });
        return _afDupe.get(dupeKey);
      }
      let res;
      try {
        res = await _orig(evt, opts);
      } catch (e) {
        if (Number(process.env.AF_DEBUG)) console.log('[AF_DEBUG] base_threw', { dupeKey, err: String(e && e.message || e) });
        res = null;
      }
      const safe = (typeof res === 'undefined') ? null : res;
      if (typeof res === 'undefined' && Number(process.env.AF_DEBUG)) console.log('[AF_DEBUG] base_return_undefined', { dupeKey });
      _afDupe.set(dupeKey, safe);
      return safe;
    };
  }
} catch (_) { /* noop */ }
