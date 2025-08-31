import fs from 'fs';
const file = 'netlify/functions/_lib/enrich.cjs';
let src = fs.readFileSync(file,'utf8');
let changed = false;

// ya está definida (la vimos en líneas ~178), solo falta exportarla
if (/module\.exports\s*=\s*\{[\s\S]*?\}/.test(src) && !/ensureMarketsWithOddsAPI\b/.test(src)) {
  src = src.replace(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/,
    (m, inner) => {
      // evitar duplicar comas/espacios
      const innerTrim = inner.trim().replace(/,\s*$/,'');
      const withComma = innerTrim.length ? innerTrim + ', ' : '';
      return `module.exports = { ${withComma}ensureMarketsWithOddsAPI }`;
    }
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-enrich-export-ensure] Patched', file);
} else {
  console.log('[codemod-enrich-export-ensure] skip (ok)');
}
