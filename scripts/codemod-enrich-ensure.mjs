import fs from 'fs';

const file = 'netlify/functions/_lib/enrich.cjs';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// 1) inyectar función si no existe
if (!/function\s+ensureMarketsWithOddsAPI\s*\(/.test(src)) {
  const fn = `
/** shim: garantiza mercados_top3 desde fixture/oddsRaw **/
async function ensureMarketsWithOddsAPI({ fixture, oddsRaw } = {}) {
  try {
    const enriched = await enrichFixtureUsingOdds({ fixture, oddsRaw });
    return enriched?.markets_top3 || {};
  } catch (_) { return {}; }
}
`.trim();

  // colocar antes de module.exports si existe, si no al final
  if (/module\.exports\s*=/.test(src)) {
    src = src.replace(/module\.exports\s*=\s*\{/, `${fn}\n\nmodule.exports = {`);
  } else {
    src = `${src.trim()}\n\n${fn}\n`;
  }
  changed = true;
}

// 2) asegurar export
if (/module\.exports\s*=/.test(src) && !/ensureMarketsWithOddsAPI/.test(src)) {
  src = src.replace(/module\.exports\s*=\s*\{([\s\S]*?)\};/,
    (m, inner) => `module.exports = {${inner.replace(/\s+$/,'')}\n  , ensureMarketsWithOddsAPI\n};`);
  changed = true;
}

// guardar si cambió
if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-enrich-ensure] Patched', file);
} else {
  console.log('[codemod-enrich-ensure] skip (already present)');
}
