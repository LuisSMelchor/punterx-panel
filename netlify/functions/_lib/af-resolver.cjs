// netlify/functions/_lib/af-resolver.cjs
// Resolver de fixture en API-FOOTBALL a partir de un partido de OddsAPI y una lista de candidatos.

const {
  nameSimilarity,
  normalizeName
} = require('./match-normalizer.cjs');

const MATCH_MIN_SCORE = Number(process.env.MATCH_MIN_SCORE || 0.72);
const MATCH_MIN_TEAM_SCORE = Number(process.env.MATCH_MIN_TEAM_SCORE || 0.62);

// Escala por diferencia horaria (en horas).
function timeScore(diffHours) {
  const d = Math.abs(diffHours);
  if (d <= 6)  return 1.00;
  if (d <= 12) return 0.95;
  if (d <= 24) return 0.90;
  if (d <= 36) return 0.85;
  if (d <= 48) return 0.80;
  if (d <= 60) return 0.75;
  return 0.60;
}

function leagueSimilarity(a, b) {
  if (!a || !b) return 0;
  return nameSimilarity(a, b);
}

function countryEq(a, b) {
  if (!a || !b) return false;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return !!na && !!nb && na === nb;
}

/**
 * Calcula el mejor fixture de API-FOOTBALL para el partido OddsAPI.
 * @param {Object} partido  { home, away, liga, pais, commence_time }
 * @param {Array} afList    data.response de AF (fixtures)
 * @returns {Object|null}   fixture { league, fixture, teams, ... } o null
 */
function resolveFixtureFromList(partido, afList) {
  if (!Array.isArray(afList) || afList.length === 0) return null;
  const tKick = Date.parse(partido?.commence_time || '') || Date.now();

  let best = null;

  for (const x of afList) {
    const tFx = Date.parse(x?.fixture?.date || '') || 0;
    const diffH = (tFx && tKick) ? Math.abs(tFx - tKick) / 3600000 : 999;

    const hAF = x?.teams?.home?.name || '';
    const aAF = x?.teams?.away?.name || '';

    // Similitudes equipo↔equipo, en orientación directa y swap
    const sHH = nameSimilarity(partido.home, hAF);
    const sAA = nameSimilarity(partido.away, aAF);
    const sHA = nameSimilarity(partido.home, aAF);
    const sAH = nameSimilarity(partido.away, hAF);

    const dirScore = (sHH + sAA) / 2;
    const swapScore = (sHA + sAH) / 2;
    const pairScore = Math.max(dirScore, swapScore);

    const tScore = timeScore(diffH);
    const lScore = leagueSimilarity(partido.liga || '', x?.league?.name || '');
    const cBonus = countryEq(partido.pais, x?.league?.country) ? 0.05 : 0;

    const finalScore = Math.min(1, 0.7 * pairScore + 0.2 * tScore + 0.1 * lScore + cBonus);

    const item = {
      x,
      pairScore,
      tScore,
      lScore,
      cBonus,
      finalScore,
      diffH
    };

    if (!best || item.finalScore > best.finalScore) {
      best = item;
    }
  }

  if (!best) return null;

  // Filtros de seguridad: exigir un mínimo de match por equipos y score global.
  if (best.pairScore < MATCH_MIN_TEAM_SCORE) return null;
  if (best.finalScore < MATCH_MIN_SCORE) return null;

  return best.x || null;
}

module.exports = { resolveFixtureFromList };
