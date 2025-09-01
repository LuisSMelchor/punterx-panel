import fs from 'fs';

const file = 'netlify/functions/_lib/enrich.cjs';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// 1) Import tolerante de odds-helpers.cjs
if (!/odds-helpers\.cjs/.test(src)) {
  const inject =
`// OddsAPI (real) - import tolerante
let fetchOddsForFixture = null;
try {
  ({ fetchOddsForFixture } = require('./odds-helpers.cjs'));
} catch (_) { fetchOddsForFixture = null; }
`;
  if (/^'use strict';/m.test(src)) {
    src = src.replace(/^'use strict';/m, `'use strict';\n\n${inject}`);
    changed = true;
  }
}

// 2) Función _maybeFetchOdds si no existe
if (!/function\s+_maybeFetchOdds\s*\(/.test(src)) {
  const helper =
`
/** fetch opcional con tolerancia a entorno sin clave */
async function _maybeFetchOdds(fixture) {
  if (!process.env.ODDS_API_KEY) return null;
  if (typeof fetchOddsForFixture !== 'function') return null;
  try { return await fetchOddsForFixture(fixture); } catch { return null; }
}
`;
  // insertar antes de la función principal de enrich si existe
  if (/function\s+enrichFixtureUsingOdds\s*\(/.test(src)) {
    src = src.replace(/function\s+enrichFixtureUsingOdds\s*\(/,
                      `${helper}\nfunction enrichFixtureUsingOdds(`);
    changed = true;
  } else {
    src = src + helper;
    changed = true;
  }
}

// 3) Dentro de enrichFixtureUsingOdds, garantizar que si no hay odds se intente _maybeFetchOdds
// Heurística: buscar declaración de _odds y añadir el fallback si no existe ya
if (/function\s+enrichFixtureUsingOdds\s*\([^\)]*\)\s*\{/.test(src)) {
  const reBody = /(function\s+enrichFixtureUsingOdds\s*\([^\)]*\)\s*\{\s*)([\s\S]*?)(\n\}\s*)/m;
  const m = src.match(reBody);
  if (m) {
    let body = m[2];
    if (!/await\s+_maybeFetchOdds\(/.test(body)) {
      // tras la línea donde se define _odds, inyectamos el fallback
      body = body.replace(/let\s+_odds\s*=\s*([^\n;]+);/, (full) =>
        full + `\n\n  // intentar fetch real si no hay odds en entrada\n  if (!_odds) { _odds = await _maybeFetchOdds(_fixture); }`
      );
      src = src.replace(reBody, `$1${body}$3`);
      changed = true;
    }
  }
}

if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-enrich] Patched', file);
} else {
  console.log('[codemod-enrich] No changes needed');
}
