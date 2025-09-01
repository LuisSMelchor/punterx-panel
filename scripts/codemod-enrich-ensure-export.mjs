import fs from 'fs';
const file = 'netlify/functions/_lib/enrich.cjs';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// A) asegurar definición
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
  if (/module\.exports\s*=/.test(src)) {
    src = src.replace(/module\.exports\s*=\s*\{/, `${fn}\n\nmodule.exports = {`);
  } else {
    src = `${src.trim()}\n\n${fn}\n`;
  }
  changed = true;
}

// B) asegurar export
if (/module\.exports\s*=/.test(src) && !/ensureMarketsWithOddsAPI/.test(src)) {
  src = src.replace(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/,
    (m, inner) => {
      const innerTrim = inner.replace(/\s+$/,'').replace(/^\s+/,'');
      const withComma = innerTrim.endsWith(',') ? innerTrim : (innerTrim ? innerTrim + ',' : '');
      return `module.exports = { ${withComma} ensureMarketsWithOddsAPI }`;
    }
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-enrich-ensure-export] Patched', file);
} else {
  console.log('[codemod-enrich-ensure-export] skip (ok)');
}
