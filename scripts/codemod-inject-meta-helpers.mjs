import fs from 'fs';

function patch(file) {
  let src = fs.readFileSync(file, 'utf8');

  const hasRequire = /ensureEnrichDefaults|setEnrichStatus/.test(src) &&
                     /require\(['"]\.\/_lib\/meta\.cjs['"]\)/.test(src);

  // Insertar require tolerante tras 'use strict' si hace falta
  if (!hasRequire) {
    const requireLine =
`let ensureEnrichDefaults, setEnrichStatus;
try { ({ ensureEnrichDefaults, setEnrichStatus } = require('./_lib/meta.cjs')); } catch (_) { /* no-op en dev */ }`;

    // si ya hay alguna var con el mismo nombre, no lo insertamos
    if (!/let\s+ensureEnrichDefaults|const\s+ensureEnrichDefaults|var\s+ensureEnrichDefaults/.test(src)) {
      src = src.replace(/^('use strict';)/m, `$1\n${requireLine}\n`);
    }
  }

  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-meta] Patched', file);
}

const files = process.argv.slice(2);
for (const f of files) patch(f);
