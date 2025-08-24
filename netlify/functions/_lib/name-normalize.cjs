'use strict';

// Eliminar diacríticos y estandarizar
function stripDiacritics(s='') {
  return s.normalize('NFD').replace(/\p{M}+/gu, ''); // \p{M} = marcas combinantes (acentos)
}

// Quitar sufijos comunes de clubes (IF, BK, FC, SC, etc.)
function stripClubSuffixes(s='') {
  // límites de palabra para no “comer” dentro de nombres compuestos
  return s.replace(/\b(afc|fc|sc|ac|cf|cfk|if|bk|fk|sk|ik)\b/gi, ' ');
}

// Normalización completa para matching
function normalizeTeamName(s='') {
  return stripClubSuffixes(stripDiacritics(String(s)))
    .toLowerCase()
    .replace(/[\.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { stripDiacritics, stripClubSuffixes, normalizeTeamName };
