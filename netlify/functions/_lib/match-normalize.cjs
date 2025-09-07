// netlify/functions/_lib/match-normalize.cjs
'use strict';

const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-+/g, '-');

// Stopwords genéricas SIN nombres fijos
// Nota: removemos 'sporting' para no perder señal en equipos reales.
// Añadimos 'clube' (PT) como genérico de "club".
const TEAM_STOPWORDS = new Set([
  // artículos multi-idioma
  'the','el','la','los','las','le','les','l','der','die','das','o','a',
  // conectores genéricos
  'de','da','do','del','di','of','and','y','e',
  // formas genéricas de "club"
  'fc','cf','ac','afc','sc','bc','bk','fk','if','sv','as','cd','sd','ud','ca','uc','us',
  'club','clube','club-de-futbol','football','futbol','futebol','fussball'
]);

// Palabras muy genéricas de competiciones (mantenemos "premier", quitamos "league"/"liga"...)
const LEAGUE_STOPWORDS = new Set([
  'league','liga','ligue','cup','copa','division','div','divisione','serie',
  'group','grupo','grupa','round','jornada','matchday'
]);

function _canonTokens(raw, stop) {
  const base = slugify(raw);
  if (!base) return [];
  const toks = base.split('-').filter(Boolean);
  // quitamos tokens 1-char y stopwords, deduplicamos consecutivos
  const filtered = toks.filter(t => t.length > 1 && !stop.has(t));
  const arr = filtered.length ? filtered : toks.filter(t => t.length > 1);
  const dedup = [];
  for (const t of arr) if (!dedup.length || dedup[dedup.length - 1] !== t) dedup.push(t);
  return dedup;
}

function canonicalTeamName(raw) {
  return _canonTokens(raw, TEAM_STOPWORDS).join('-');
}

function canonicalLeagueName(raw) {
  return _canonTokens(raw, LEAGUE_STOPWORDS).join('-');
}

function getCountry3(c) {
  const s = String(c || '').toUpperCase().replace(/[^A-Z]/g,'');
  return s.slice(0,3) || null;
}

function minutesDiffFromNow(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 60000);
}

function band(m) {
  if (m == null) return 'unknown';
  if (m < 0) return 'past';
  if (m < 15) return 't_0_15';
  if (m < 30) return 't_15_30';
  if (m < 60) return 't_30_60';
  return 't_60_plus';
}

function normalizeFixture(fx) {
  const home = canonicalTeamName(fx?.home);
  const away = canonicalTeamName(fx?.away);
  const league = canonicalLeagueName(fx?.league);
  const country = getCountry3(fx?.country);
  const iso = fx?.start_ts ? new Date(fx.start_ts).toISOString() : null;
  const day = iso ? iso.slice(0,10) : 'unknown';
  const key = `${day}_${home || 'home'}_vs_${away || 'away'}`;
  const m = minutesDiffFromNow(iso);
  return {
    key,
    normalized: { home, away, league, country, start_ts: iso },
    timing: { minutes_to_start: m, band: band(m) },
    echo: { has_odds: !!fx?.odds }
  };
}

module.exports = {
  slugify,
  TEAM_STOPWORDS,
  canonicalTeamName,
  canonicalLeagueName,
  minutesDiffFromNow,
  band,
  normalizeFixture
};
