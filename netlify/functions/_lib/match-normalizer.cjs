// match-normalizer.cjs
// -------------------------------------------------------------
// Normalizador de nombres de equipos/ligas con tolerancia básica.
// Exporta: normTeam, normLeague, fuzzyEq
// -------------------------------------------------------------
'use strict';

/**
 * Normaliza cadenas removiendo acentos, siglas y variantes comunes.
 * - Quita acentos
 * - Elimina siglas FC/CF/SC
 * - Elimina marcadores U19/U21/U23/II/B
 * - Colapsa espacios
 */
function normBase(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // diacríticos
    .replace(/\./g, ' ')                              // puntos
    .replace(/\b(?:fc|cf|sc)\b/gi, '')                // siglas
    .replace(/\b(?:u\d{2}|ii|b)\b/gi, '')             // U19/U21/U23, II, B
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normaliza nombre de equipo.
 * @param {string} s
 * @returns {string}
 */
function normTeam(s) {
  return normBase(s);
}

/**
 * Normaliza nombre de liga.
 * @param {string} s
 * @returns {string}
 */
function normLeague(s) {
  return normBase(s);
}

/**
 * Comparación laxa:
 * - Igualdad exacta tras normalizar
 * - Contención si la cadena larga contiene a la corta (mín 7 chars)
 */
function fuzzyEq(a, b) {
  const A = normBase(a);
  const B = normBase(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const minLen = 7;
  if (A.length >= minLen && (A.includes(B))) return true;
  if (B.length >= minLen && (B.includes(A))) return true;
  return false;
}

module.exports = { normTeam, normLeague, fuzzyEq };
