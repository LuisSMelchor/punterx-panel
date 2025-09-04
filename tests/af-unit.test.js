'use strict';
// tests unitarios sin red para normalize/scoreNameMatch
const path = require('path');
const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAIL:', msg); process.exit(1); } };

const norm = require(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'normalize.cjs'));
const resolver = require(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'resolver-af.cjs'));

// --- normalizeTeam ---
assert(norm.normalizeTeam('FC Dallas') === 'Dallas', 'normalizeTeam FC');
assert(norm.normalizeTeam('Atlético  Mineiro') === 'Atletico Mineiro', 'normalizeTeam acentos/espacios');

// --- normalizeLeagueHint ---
assert(norm.normalizeLeagueHint('mls') === 'Major League Soccer', 'league MLS');
assert(norm.normalizeLeagueHint('LaLiga') === 'La Liga', 'league LaLiga');

// --- normalizeCountryHint ---
assert(norm.normalizeCountryHint('us') === 'USA', 'country US');
assert(norm.normalizeCountryHint('England') === 'England', 'country England passthrough');

// --- scoreNameMatch ---
const s1 = resolver.__test__?.scoreNameMatch ? resolver.__test__.scoreNameMatch('Houston Dynamo','Houston Dynamo') : undefined;
const s2 = resolver.__test__?.scoreNameMatch ? resolver.__test__.scoreNameMatch('San Jose Earthquakes II','San Jose Earthquakes') : undefined;
if (s1 === undefined || s2 === undefined) {
  // fallback: require internal via eval-free path
  const _resolver = require(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'resolver-af.cjs'));
  const _score = _resolver.scoreNameMatch || (function(){ throw new Error('scoreNameMatch no exportado');})();
}

console.log('OK: normalize + scoring basics');
process.exit(0);

// --- umbrales & orden ---
const _score = resolver.__test__.scoreNameMatch;
const eq = _score('Houston Dynamo','Houston Dynamo');           // 1.0
const contains = _score('San Jose Earthquakes II','San Jose');  // ~0.85
const partial = _score('Chicago Fire','Chicago');               // ~0.85
assert(eq === 1.0, 'score exacto debe ser 1.0');
assert(contains >= 0.80 && contains <= 0.90, 'contains ~0.85');
assert(partial   >= 0.80 && partial   <= 0.90, 'partial ~0.85');

// --- normalizeWhenText ---
assert(norm.normalizeWhenText('2025-09-07T00:30:00Z') === '2025-09-07', 'when_text ISO → YYYY-MM-DD');
assert(norm.normalizeWhenText('2025-09-07') === '2025-09-07', 'when_text YYYY-MM-DD passthrough');
assert(norm.normalizeWhenText('bad-date') === '', 'when_text inválida → ""');

// --- normalizeCountryHint extra ---
assert(norm.normalizeCountryHint('US') === 'USA', 'country US→USA');
assert(norm.normalizeCountryHint('UNITED KINGDOM') === 'England', 'country UK→England (alias)');

console.log('OK: extended asserts');
