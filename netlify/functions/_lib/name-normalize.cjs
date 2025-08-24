'use strict';



// Transliteration genérica para letras "compat" (ø, ß, æ, œ, ł, đ, þ, ð, ħ, …)
function compatFold(str=''){
  const map = {
    'ø':'o','Ø':'O','đ':'d','Đ':'D','ł':'l','Ł':'L','ß':'ss','ẞ':'SS',
    'æ':'ae','Æ':'AE','œ':'oe','Œ':'OE','ð':'d','Ð':'D','þ':'th','Þ':'Th',
    'ħ':'h','Ħ':'H','ı':'i','ſ':'s','ƒ':'f','Ƒ':'F','ĳ':'ij','Ĳ':'IJ'
  };
  // Sustituye cualquier no-ASCII por su plegado si está en el mapa
  return str.replace(/[\u0080-\uFFFF]/g, ch => map[ch] ?? ch);
}
// Eliminar diacríticos y estandarizar
function stripDiacritics(s='') {
  return s.normalize('NFKD').replace(/\p{M}+/gu, ''); // \p{M} = marcas combinantes (acentos)
}

// Quitar sufijos comunes de clubes (IF, BK, FC, SC, etc.)

function stripClubTokens(str=''){
  // Tokens genéricos de "club" comunes en muchas ligas/idiomas (no específicos por equipo):
  // OJO: NO incluimos 'union', 'universidad', etc.
  const TOKENS = [
    'fc','sc','cf','ac','afc','bk','fk','sk','ik','cd','ud','sv',
    'ca','ss','ssc','club','sporting','sport', 'atletico','atlético'
  ];
  const re = new RegExp('\\b(?:' + TOKENS.join('|') + ')\\b','gi');
  return str.replace(re, ' ');
}


// Normalización completa para matching
function normalizeTeamName(s='') {
  return compatFold(stripClubTokens(stripDiacritics(String(s))))
    .toLowerCase()
    .replace(/[\.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { stripDiacritics, stripClubSuffixes, normalizeTeamName };
