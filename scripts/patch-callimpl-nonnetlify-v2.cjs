'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

// Sustituye sólo el bloque con codeNL por versión tolerant
const RX =
/\/\/ No es Netlify-style:[\s\S]*?let codeNL = 200;[\s\S]*?return respond\(payload, codeNL\);\n/m;

const REPL = `// No es Netlify-style: si es objeto, pásalo; si es primitivo, booleanízalo
const payload = (res && typeof res === 'object') ? res : { ok: !!res };
// Normalización robusta forbidden/auth -> 403
let codeNL = 200;
try {
  const err   = String(payload && (payload.error ?? payload.raw ?? '')).toLowerCase();
  const stage = String(payload && (payload.stage ?? '')).toLowerCase();
  const reas  = String(payload && (payload.reason ?? '')).toLowerCase();
  const isForbidden =
    err === 'forbidden' ||
    (payload && payload.ok === false && stage === 'auth') ||
    reas.includes('auth') || reas.includes('forbidden');
  if (isForbidden) codeNL = 403;
} catch (_) {}
return respond(payload, codeNL);
`;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!RX.test(src)) {
    console.log('[AF_DEBUG]', file, ': patrón no encontrado (skipped)');
    continue;
  }
  const out = src.replace(RX, REPL);
  const bak = `${file}.bak.${Date.now()}`;
  fs.writeFileSync(bak, src, 'utf8');
  fs.writeFileSync(file, out, 'utf8');
  console.log('[AF_DEBUG]', file, ': patched (backup:', bak, ')');
}
