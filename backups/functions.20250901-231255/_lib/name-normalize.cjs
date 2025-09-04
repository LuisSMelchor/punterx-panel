// netlify/functions/_lib/name-normalize.cjs
'use strict';

/**
 * Normaliza nombres de equipos de forma genérica (sin alias fijos).
 * - Quita diacríticos (NFKD + \p{M})
 * - Plegado de compatibilidad para letras especiales (ø→o, ß→ss, æ→ae, …)
 * - Elimina tokens genéricos de clubes (fc, if, bk, sc, club, sporting, etc.) SOLO como palabras completas
 * - Pasa a minúsculas, elimina puntuación simple y colapsa espacios
 */

function stripDiacritics(s='') {
  // NFKD separa letras de marcas combinantes; \p{M} = marks
  return String(s).normalize('NFKD').replace(/\p{M}+/gu, '');
}

function compatFold(str='') {
  const map = {
    'ø':'o','Ø':'O','đ':'d','Đ':'D','ł':'l','Ł':'L','ß':'ss','ẞ':'SS',
    'æ':'ae','Æ':'AE','œ':'oe','Œ':'OE','ð':'d','Ð':'D','þ':'th','Þ':'Th',
    'ħ':'h','Ħ':'H','ı':'i','ſ':'s','ƒ':'f','Ƒ':'F','ĳ':'ij','Ĳ':'IJ'
  };
  return String(str).replace(/[\u0080-\uFFFF]/g, ch => map[ch] ?? ch);
}

function stripClubTokens(s='') {
  // tokens muy comunes; se eliminan solo si aparecen como palabra completa
  const TOKENS = [
    'fc','sc','cf','ac','afc','bk','fk','sk','ik','cd','ud','sv',
    'ca','ss','ssc','club','sporting','sport','atletico','atlético'
  ];
  const re = new RegExp('\\b(?:' + TOKENS.join('|') + ')\\b','gi');
  return String(s).replace(re, ' ');
}

function normalizeTeamName(s='') {
  const raw = compatFold(stripClubTokens(stripDiacritics(String(s))))
    .toLowerCase()
    .replace(/[\.\-]/g, ' ')     // puntos/guiones a espacio
    .replace(/[^\p{L}\p{N} ]+/gu, ' ') // cualquier otro símbolo a espacio
    .replace(/\s+/g, ' ')        // colapsa espacios
    .trim();
  return raw;
}

module.exports = { stripDiacritics, compatFold, stripClubTokens, normalizeTeamName };
