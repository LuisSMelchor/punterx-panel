// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * API-FOOTBALL helpers y resoluciones de fixture por nombres.
 * - No usamos nombres fijos ni listas blancas/negras.
 * - Fuzzy matching tolerante a signos/acentos y variantes.
 * - Sin pruebas con partidos simulados.
 */

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
if (!API_FOOTBALL_KEY) {
  console.error('af-resolver.cjs: falta API_FOOTBALL_KEY en el entorno');
}

const AF_BASE = 'https://v3.football.api-sports.io';

/** Normaliza nombres para comparar */
function norm(s) {
  return (s || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Similaridad simple por tokens (Jaccard suavizado) */
function tokenScore(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

/** Puntuación del fixture vs par (home, away) */
function scoreFixture(fx, homeName, awayName) {
  const h = fx?.teams?.home?.name || '';
  const a = fx?.teams?.away?.name || '';
  // Acepta orden invertido si OddsAPI da local/visitante distinto
  const scoreDirect = tokenScore(h, homeName) + tokenScore(a, awayName);
  const scoreSwap   = tokenScore(h, awayName) + tokenScore(a, homeName);
  return Math.max(scoreDirect, scoreSwap);
}

/** Fetch genérico contra API-FOOTBALL */
async function afApi(path) {
  const url = `${AF_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_FOOTBALL_KEY,
      'accept': 'application/json'
    },
    timeout: 10000
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`AF ${res.status} ${res.statusText} ← ${path} · ${text.slice(0,200)}`);
  }
  const json = await res.json();
  return json;
}

/**
 * Busca fixtures por NOMBRES usando una sola llamada por fecha:
 *  - /fixtures?date=YYYY-MM-DD
 * Luego filtra localmente por parecido con los nombres.
 * names: string[] con posibles alias que venimos manejando
 * dateIso: "YYYY-MM-DD" en UTC
 */
async function searchFixturesByNames(names, dateIso) {
  const dateStr = (dateIso || new Date().toISOString().slice(0,10));
  const j = await afApi(`/fixtures?date=${dateStr}`);
  const list = Array.isArray(j?.response) ? j.response : [];

  // Aplanamos candidatos, puntuamos contra CUALQUIER nombre provisto
  const rows = [];
  for (const fx of list) {
    let best = 0;
    for (const nm of names || []) {
      // Comparamos contra ambos equipos con el mismo alias
      best = Math.max(
        best,
        scoreFixture(fx, nm, nm) // alias genérico (home/away)
      );
    }
    // Si vienen pares (home, away), probamos también
    if (Array.isArray(names) && names.length >= 2) {
      best = Math.max(best, scoreFixture(fx, names[0], names[1]));
    }
    rows.push({
      fixture_id: fx?.fixture?.id,
      kickoff: fx?.fixture?.date,
      league_id: fx?.league?.id,
      league_name: fx?.league?.name,
      country: fx?.league?.country,
      home_id: fx?.teams?.home?.id,
      away_id: fx?.teams?.away?.id,
      home_name: fx?.teams?.home?.name,
      away_name: fx?.teams?.away?.name,
      score: best
    });
  }

  // Ordenamos por score desc y quitamos duplicados por fixture_id
  rows.sort((a,b)=> (b.score - a.score));
  const seen = new Set();
  const uniq = [];
  for (const r of rows) {
    if (r.fixture_id && !seen.has(r.fixture_id)) {
      seen.add(r.fixture_id);
      uniq.push(r);
    }
  }
  return uniq;
}

/**
 * Fallback local: dado el evento "partido" y una lista de fixtures AF (arr),
 * elige el mejor por nombres. Devuelve shape mínimo que usa autopick.
 */
function resolveFixtureFromList(partido, arr) {
  const home = partido?.home || partido?.equipos?.local || '';
  const away = partido?.away || partido?.equipos?.visitante || '';

  let bestFx = null;
  let best = -1;
  for (const fx of Array.isArray(arr) ? arr : []) {
    const s = scoreFixture(fx, home, away);
    if (s > best) {
      best = s;
      bestFx = fx;
    }
  }
  if (!bestFx) return null;
  return {
    fixture_id: bestFx?.fixture?.id,
    kickoff: bestFx?.fixture?.date,
    league_id: bestFx?.league?.id,
    league_name: bestFx?.league?.name,
    country: bestFx?.league?.country,
    home_id: bestFx?.teams?.home?.id,
    away_id: bestFx?.teams?.away?.id,
  };
}

module.exports = {
  afApi,
  searchFixturesByNames,
  resolveFixtureFromList,
};
