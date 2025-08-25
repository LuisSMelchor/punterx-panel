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

async function afApi(path, params = {

/**
 * searchFixturesByNames (opcional): no lo usas directo hoy,
 * pero lo exponemos por si necesitas refinar búsquedas en otra etapa.
 */

async function searchFixturesByNames({ dateISO, leagueId, season, timezone }) {
  const params = {};
  if (dateISO) params.date = String(dateISO).slice(0, 10);
  if (leagueId) params.league = leagueId;
  if (season) params.season = season;
  if (timezone) params.timezone = timezone;
  // Consulta /fixtures con filtros; afApi valida y devuelve array de response
  return afApi('/fixtures', params);
}
