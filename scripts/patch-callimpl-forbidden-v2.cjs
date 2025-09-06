'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

// Sustituye sólo el bloque que ya metimos (outStatus) por uno más robusto
const RX =
/\/\/ body objeto -> devuélvelo tal cual \(JSON\) con normalización de forbidden->403[\s\S]*?return \{ statusCode: outStatus, headers, body: JSON\.stringify\(obj\) \};/m;

const REPL = `// body objeto -> devuélvelo tal cual (JSON) con normalización robusta forbidden/auth -> 403
const obj = (res.body == null) ? { ok:true } : res.body;
let outStatus = status;
try {
  const err   = String(obj && (obj.error ?? obj.raw ?? '')).toLowerCase();
  const stage = String(obj && (obj.stage ?? '')).toLowerCase();
  const reas  = String(obj && (obj.reason ?? '')).toLowerCase();
  const isForbidden =
    err === 'forbidden' || err === 'forbidden' ||
    (obj && obj.ok === false && stage === 'auth') ||
    reas.includes('auth') || reas.includes('forbidden');
  if (isForbidden) outStatus = 403;
} catch (_) {}
return { statusCode: outStatus, headers, body: JSON.stringify(obj) };`;

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
