'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

// Reemplaza sólo el retorno del branch "body objeto"
const RX_TARGET =
/(\/\/ body objeto\s*->[^\n]*\n\s*const obj\s*=\s*\(res\.body == null\)\s*\?\s*\{\s*ok:true\s*\}\s*:\s*res\.body;\s*\n\s*return\s*\{\s*statusCode:\s*status,\s*headers,\s*body:\s*JSON\.stringify\(obj\)\s*\};)/m;

const REPLACEMENT = `// body objeto -> devuélvelo tal cual (JSON) con normalización de forbidden->403
const obj = (res.body == null) ? { ok:true } : res.body;
let outStatus = status;
try {
  const err = (obj && (obj.error || obj.raw || obj.stage));
  const isForbidden =
    (obj && (obj.error === 'forbidden' || obj.raw === 'Forbidden')) ||
    (obj && obj.ok === false && String(obj.stage||'').toLowerCase() === 'auth');
  if (isForbidden) outStatus = 403;
} catch (_) {}
return { statusCode: outStatus, headers, body: JSON.stringify(obj) };`;

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
