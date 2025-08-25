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

async function afApi(path, params = {

/**
 * Intenta resolver fixture y/o teamIds:
 *  - Primero por fixtures del día (si hay commence + liga)
 *  - Si no, resuelve teamIds por /teams y devuelve lo que consiga
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
