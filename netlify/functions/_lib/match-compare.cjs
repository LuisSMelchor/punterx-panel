// netlify/functions/_lib/match-compare.cjs
'use strict';


/* __PX_COERCE_STARTMS__ :: coacciona fecha a ms desde start_ts|commence|kickoff (ISO o num) */
function __pxCoerceStartMs(o){
  if (!o || typeof o!=='object') return;
  let v = (o.start_ts ?? o.commence ?? o.kickoff ?? null);
  if (v==null) return;
  let ms = null;
  if (typeof v==='string') {
    // intenta ISO; si no, castea numérico
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) { ms = parsed; }
    else {
      const n = Number(v);
      if (Number.isFinite(n)) ms = n;
    }
  } else if (typeof v==='number') {
    ms = v;
  }
  if (ms==null || !Number.isFinite(ms)) return;
  if (ms < 1e12) ms *= 1000;         // segundos → ms
  o.start_ts = ms;
}
const Lib = require('./match-normalize.cjs');
const { canonicalTeamName, canonicalLeagueName, normalizeFixture } = Lib;

function tokensFromCanonical(s) {
  return String(s || '').split('-').filter(Boolean);
}

function jaccard(aArr, bArr) {
  const A = new Set(aArr), B = new Set(bArr);
  const inter = [...A].filter(x => B.has(x)).length;
  const uni = new Set([...aArr, ...bArr]).size || 1;
  return inter / uni;
}

function teamSimilarity(homeA, awayA, homeB, awayB) {
  const ha = tokensFromCanonical(canonicalTeamName(homeA));
  const aa = tokensFromCanonical(canonicalTeamName(awayA));
  const hb = tokensFromCanonical(canonicalTeamName(homeB));
  const ab = tokensFromCanonical(canonicalTeamName(awayB));

  const aligned = (jaccard(ha, hb) + jaccard(aa, ab)) / 2;
  const swapped = (jaccard(ha, ab) + jaccard(aa, hb)) / 2;

  return (swapped > aligned)
    ? { score: swapped, alignment: 'swapped' }
    : { score: aligned, alignment: 'aligned' };
}

function leagueSimilarity(lA, lB) {
  const la = tokensFromCanonical(canonicalLeagueName(lA));
  const lb = tokensFromCanonical(canonicalLeagueName(lB));
  return jaccard(la, lb);
}

function dateFactor(startA, startB) {
  const tA = Date.parse(startA); const tB = Date.parse(startB);
  if (!Number.isFinite(tA) || !Number.isFinite(tB)) return 0.5; // neutral si falta info
  const dayA = new Date(tA).toISOString().slice(0,10);
  const dayB = new Date(tB).toISOString().slice(0,10);
  if (dayA === dayB) return 1.0;
  const diffDays = Math.abs((tA - tB) / (24*3600*1000));
  if (diffDays <= 1) return 0.6;
  return 0.2;
}

function countryMatch(cA, cB) {
  const a = String(cA || '').toUpperCase().slice(0,3);
  const b = String(cB || '').toUpperCase().slice(0,3);
  if (!a || !b) return 0.5;
  return a === b ? 1.0 : 0.0;
}

function compareFixtures(A, B) {
  try { __pxCoerceStartMs(A); __pxCoerceStartMs(B); } catch {}
  const na = normalizeFixture(A);
  const nb = normalizeFixture(B);

  const team = teamSimilarity(na.normalized.home, na.normalized.away, nb.normalized.home, nb.normalized.away);
  const lg = leagueSimilarity(na.normalized.league, nb.normalized.league);
  const dt = dateFactor(na.normalized.start_ts, nb.normalized.start_ts);
  const co = countryMatch(na.normalized.country, nb.normalized.country);

  // Pesos: equipos 55, liga 20, fecha 15, país 10
  const score = Math.round(
    (team.score * 55 + lg * 20 + dt * 15 + co * 10) * 100
  ) / 100;

  return {
    score,
    parts: {
      teams: { score: team.score, alignment: team.alignment },
      league: lg,
      date: dt,
      country: co
    },
    A: na,
    B: nb
  };
}

function decide(score, parts, opts = {}) {
  const th = Number.isFinite(opts.threshold) ? opts.threshold : 75;
  const teamOK = parts.teams.score >= (opts.teamMin ?? 0.50);
  const leagueOK = parts.league   >= (opts.leagueMin ?? 0.60);
  const dateOK   = parts.date     >= (opts.dateMin ?? 0.60);
  const countryOK= parts.country  >= (opts.countryMin ?? 0.50);
  const same = score >= th && teamOK && leagueOK && dateOK && countryOK;
  const reasons = [];
  if (!same) {
    if (score < th) reasons.push('score<th');
    if (!teamOK) reasons.push('teams');
    if (!leagueOK) reasons.push('league');
    if (!dateOK) reasons.push('date');
    if (!countryOK) reasons.push('country');
  }
  return { same, threshold: th, reasons: reasons.length ? reasons.join(',') : 'ok' };
}

module.exports = { compareFixtures, decide };
