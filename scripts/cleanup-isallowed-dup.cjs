'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const RX_FUN = /function\s+isAllowed\s*\(\s*event\s*\)\s*\{[\s\S]*?\}\s*;?/gm;

  const matches = [...src.matchAll(RX_FUN)];
  if (matches.length <= 1) {
    console.log('[AF_DEBUG]', file, ': nada que borrar (isAllowed x', matches.length, ')');
    continue;
  }

  // Mantener la primera, borrar todas las siguientes
  let out = src;
  for (let i = matches.length - 1; i >= 1; i--) {
    const m = matches[i];
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }

  const bak = `${file}.bak.${Date.now()}`;
  fs.writeFileSync(bak, src, 'utf8');
  fs.writeFileSync(file, out, 'utf8');
  console.log('[AF_DEBUG]', file, ': duplicados de isAllowed eliminados (backup:', bak, ')');
}
