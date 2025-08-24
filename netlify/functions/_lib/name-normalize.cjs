'use strict';

// Quita diacríticos y normaliza a minúsculas
function stripDiacritics(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')        // marcas diacríticas
    .toLowerCase();
}

// Elimina sufijos comunes de clubes al FINAL del nombre (conservador)
function stripClubSuffixes(s = '') {
  // tokens típicos en múltiples ligas/idiomas
  const suffixes = [
    'fc','cf','afc','sc','ac','as','cd','ca','ud','sad','fk','bk','ik',
    'utd','united','city','club','deportivo','sporting'
  ];
  let out = s;
  // elimina tokens sueltos al final o entre paréntesis/guiones
  const rx = new RegExp(`\\s+(?:${suffixes.join('|')})\\.?$`, 'i');
  for (let i = 0; i < 2; i++) { // dos pasadas por si hay dos tokens
    out = out.replace(rx, '');
  }
  return out.trim();
}

// Normalización completa de nombres de equipos
function normalizeTeamName(raw = '') {
  if (!raw) return '';
  let s = stripDiacritics(raw);
  // quita puntuación y apóstrofes / puntos / comas / guiones suaves
  s = s.replace(/['’`.,]/g, ' ');
  s = s.replace(/[()]/g, ' ');
  s = s.replace(/[-–—]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = stripClubSuffixes(s);
  // colapsa dobles espacios de nuevo tras strip suffixes
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

module.exports = { stripDiacritics, stripClubSuffixes, normalizeTeamName };
