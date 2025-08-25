// netlify/functions/_lib/af-resolver.cjs
'use strict';

/**
 * Resolución de teamId usando API-FOOTBALL solo con normalización genérica.
 * - Sin alias fijos. Coincidencia por similitud de tokens.
 */

const { normalizeTeamName } = require('./name-normalize.cjs');

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const MATCH_RESOLVE_CONFIDENCE = (() => {
  const n = parseFloat(process.env.MATCH_RESOLVE_CONFIDENCE || '');
  return Number.isFinite(n) ? n : 0.72;
})();

function tokenSet(str=''){
  return new Set(normalizeTeamName(str).split(' ').filter(Boolean));
}
function jaccard(aStr, bStr){
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (A.size===0 || B.size===0) return 0;
  let inter=0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter/union;
}
function dice(aStr,bStr){
  const A = tokenSet(aStr), B = tokenSet(bStr);
  if (A.size===0 || B.size===0) return 0;
  let inter=0;
  for (const t of A) if (B.has(t)) inter++;
  return (2*inter)/(A.size+B.size);
}
function sim(a,b){
  // Combina Jaccard y Dice; prioriza igualdad exacta
  if (!a || !b) return 0;
  const na = normalizeTeamName(a), nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na===nb) return 1;
  return Math.max(jaccard(na,nb), dice(na,nb));
}

async function afFetch(path, params={}){
  const base = 'https://v3.football.api-sports.io';
  const url = new URL(base + path);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
  const _fetch = global.fetch || (await import('node-fetch')).default;
  const res = await _fetch(url, { headers });
  if (!res.ok) throw new Error(`AF ${path} ${res.status}`);
  return res.json();
}

async function searchTeams(q){
  if (!API_FOOTBALL_KEY) return [];
  const j = await afFetch('/teams', { search: normalizeTeamName(q) }).catch(()=>null);
  const arr = j && j.response || [];
  return arr.map(x => x && x.team).filter(Boolean);
}

// === drop-in: reemplaza pickTeamId existente ===
async function pickTeamId(afApi, rawName, { leagueHint, commence } = {}) {
  const qRaw = String(rawName || '').trim();
  if (!qRaw) return null;

  // normaliza solo para la similitud; la query a la API usa el texto del usuario
  const norm = (t) => String(t).toLowerCase().normalize('NFD')
    .replace(/\p{M}+/gu,'').replace(/[^a-z0-9 ]/g,' ')
    .replace(/\s+/g,' ').trim();

  const want = norm(qRaw);
  const year = commence ? new Date(commence).getUTCFullYear() : null;

  // 1) si hay pista de liga, intenta acotar por liga+temporada (recomendado por API-FOOTBALL)
  //    - /leagues?search=<liga>
  //    - elige la que tenga season==year (si hay commence), o la temporada "current"
  let leagueId = null, season = null;
  if (leagueHint) {
    const L = await afApi(`/leagues?search=${encodeURIComponent(leagueHint)}`);
    const leagues = (L && L.response) || [];
    // pick liga cuya seasons incluya el año, o la current si no tenemos commence
    let best = null;
    for (const item of leagues) {
      const seasons = item.seasons || [];
      if (year) {
        if (seasons.some(s => String(s.year) === String(year))) {
          best = item;
          break;
        }
      } else {
        best = seasons.some(s => s.current) ? item : (best || item);
      }
    }
    if (best && best.league && best.league.id) {
      leagueId = best.league.id;
      // prioriza temporada exacta; si no, la current; si no, última conocida
      const seasons = best.seasons || [];
      season = year
        ? (seasons.find(s => String(s.year)===String(year))?.year)
        : (seasons.find(s => s.current)?.year || seasons.at(-1)?.year || null);
    }
  }

  // 2) busca equipos: si tenemos leagueId, filtra por liga (mucho más preciso)
  let teamsResp;
  if (leagueId) {
    const path = `/teams?league=${leagueId}` +
                 (season ? `&season=${season}` : '') +
                 `&search=${encodeURIComponent(qRaw)}`;
    teamsResp = await afApi(path);
  } else {
    // fallback amplio si no hay pista de liga
    teamsResp = await afApi(`/teams?search=${encodeURIComponent(qRaw)}`);
  }

  const candidates = (teamsResp && teamsResp.response) || [];
  if (!candidates.length) return null;

  // 3) elige por similitud del nombre (sin strip agresivo de tokens)
  let bestId = null, bestScore = -1;
  for (const it of candidates) {
    const name = it?.team?.name || '';
    if (!name) continue;
    const score = sim(want, norm(name));
    if (score > bestScore) {
      bestScore = score;
      bestId = it.team.id || null;
    }
  }

  // si tu pipeline usa umbral, respétalo; si no, solo devuelve el mejor
  // (SIM_THR llega desde el módulo de config; si no existe aquí, comenta el umbral)
  try {
    if (typeof SIM_THR === 'number' && bestScore < SIM_THR) return null;
  } catch (_) { /* ignore if SIM_THR not in scope */ }

  return bestId || null;
}

module.exports = { pickTeamId, sim };
