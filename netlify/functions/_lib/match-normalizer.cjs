// netlify/functions/_lib/match-normalizer.cjs
// Utilidades de normalización y similitud (sin dependencias externas).

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const TEAM_STOPWORDS = new Set([
  // artículos y conectores comunes (multi idioma)
  'the','de','del','da','do','la','las','los','el','un','una','and','y','u','di',
  // sufijos/abreviaturas muy comunes en clubes
  'fc','c','cf','sc','ac','ud','cd','ca','sd','bk','fk','if','ks','sk','sp','sv','afc',
  // palabras genéricas
  'club','deportivo','sport','sports','as','ss','us','fk','ik','bk'
]);

function normalizeName(raw) {
  const s = stripAccents(raw).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = s.split(' ')
    .filter(Boolean)
    .filter(t => !TEAM_STOPWORDS.has(t))
    .map(t => t.length <= 3 ? t : t); // mantenemos tokens (no hacemos stemming)
  return tokens.join(' ').trim();
}

function tokenize(s) {
  const t = normalizeName(s);
  return t ? t.split(' ') : [];
}

function jaccard(aTokens, bTokens) {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

// Implementación simple de Jaro-Winkler para cadenas ya normalizadas.
function jaroWinkler(a, b) {
  a = normalizeName(a); b = normalizeName(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const mDist = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;

  // Jaro - matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - mDist);
    const end = Math.min(i + mDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Jaro - transpositions
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t = t / 2;

  const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;

  // Winkler prefix bonus
  let l = 0;
  const maxL = 4;
  while (l < Math.min(maxL, a.length, b.length) && a[l] === b[l]) l++;
  const p = 0.1;

  return jaro + l * p * (1 - jaro);
}

function nameSimilarity(a, b) {
  const A = normalizeName(a);
  const B = normalizeName(b);
  if (!A && !B) return 1;
  if (!A || !B) return 0;

  const jw = jaroWinkler(A, B);
  const jac = jaccard(A.split(' '), B.split(' '));

  // Bonus leve si uno contiene al otro (por tokens), útil en “pumas” vs “pumas unam”
  const aSet = new Set(A.split(' '));
  const bSet = new Set(B.split(' '));
  const aInB = [...aSet].every(t => bSet.has(t));
  const bInA = [...bSet].every(t => aSet.has(t));
  const containBonus = (aInB || bInA) ? 0.05 : 0;

  // Mezcla robusta
  let sim = 0.6 * jw + 0.4 * jac + containBonus;
  if (sim > 1) sim = 1;
  if (sim < 0) sim = 0;
  return sim;
}

function canonicalPairKey(home, away) {
  const h = normalizeName(home);
  const a = normalizeName(away);
  return [h, a].sort().join(' | ');
}

module.exports = {
  stripAccents,
  normalizeName,
  tokenize,
  jaccard,
  jaroWinkler,
  nameSimilarity,
  canonicalPairKey
};
