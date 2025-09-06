'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

// Target: bloque "No es Netlify-style..."
const RX_TARGET =
/(\/\/ No es Netlify-style:[\s\S]*?const payload\s*=\s*\(res\s*&&\s*typeof res === 'object'\)\s*\?\s*res\s*:\s*\{\s*ok:\s*!!res\s*\};\s*\n\s*return\s*respond\(payload,\s*200\);\s*)/m;

const REPLACEMENT = `// No es Netlify-style: si es objeto, pásalo; si es primitivo, booleanízalo
const payload = (res && typeof res === 'object') ? res : { ok: !!res };
// Normalización forbidden/auth -> 403
let codeNL = 200;
try {
  const isForbidden =
    (payload && (payload.error === 'forbidden' || payload.raw === 'Forbidden')) ||
    (payload && payload.ok === false && String(payload.stage||'').toLowerCase() === 'auth');
  if (isForbidden) codeNL = 403;
} catch (_) {}
return respond(payload, codeNL);
`;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!RX_TARGET.test(src)) {
    console.log(`[AF_DEBUG] ${file}: patrón no encontrado (nada que cambiar)`);
    continue;
  }
  const out = src.replace(RX_TARGET, REPLACEMENT);
  const bak = `${file}.bak.${Date.now()}`;
  fs.writeFileSync(bak, src, 'utf8');
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[AF_DEBUG] ${file}: parche aplicado (backup: ${bak})`);
}
