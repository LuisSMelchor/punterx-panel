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

async function pickTeamId(name){
  if (!name) return null;
  const teams = await searchTeams(name);
  if (!teams.length) return null;
  // Puntúa y elige mejor
  let best = null, bestScore = -1;
  for (const t of teams){
    const score = sim(name, t.name);
    if (score > bestScore){
      best = t;
      bestScore = score;
    }
  }
  if (best && bestScore >= MATCH_RESOLVE_CONFIDENCE) return best.id;
  return null;
}

module.exports = { pickTeamId, sim };
