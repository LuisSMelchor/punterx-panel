'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

// buscamos el bloque: if (("bypass" in q) && allowed) { return await callImpl(event, context); }
const RX = /if\s*\(\s*\("bypass"\s*in\s*q\)\s*&&\s*allowed\s*\)\s*\{\s*return\s+await\s+callImpl\(event,\s*context\);\s*\}/m;

const REPL = `if (("bypass" in q) && allowed) {
  // Wrapper: ejecuta impl y re-map a 403 si body indica forbidden/auth
  const res = await callImpl(event, context);
  try {
    const headers = Object.assign({ 'content-type':'application/json; charset=utf-8' }, (res && res.headers) || {});
    const txt = (res && res.body != null) ? String(res.body) : '';
    let obj = null;
    try { obj = txt && txt.trim().startsWith('{') ? JSON.parse(txt) : null; } catch (_) { obj = null; }
    const err   = String(obj && (obj.error ?? obj.raw ?? '')).toLowerCase();
    const stage = String(obj && (obj.stage ?? '')).toLowerCase();
    const reas  = String(obj && (obj.reason ?? '')).toLowerCase();
    const isForbidden =
      err === 'forbidden' ||
      (obj && obj.ok === false && stage === 'auth') ||
      (reas.includes('auth') || reas.includes('forbidden'));
    if (isForbidden) {
      return { statusCode: 403, headers, body: JSON.stringify(obj ?? {}) };
    }
  } catch (_){}
  return res;
}`;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (!RX.test(src)) {
    console.log('[AF_DEBUG]', file, ': patrón bypass simple no encontrado (skip, quizá ya envuelto)');
    continue;
  }
  const out = src.replace(RX, REPL);
  const bak = `${file}.bak.${Date.now()}`;
  fs.writeFileSync(bak, src, 'utf8');
  fs.writeFileSync(file, out, 'utf8');
  console.log('[AF_DEBUG]', file, ': bypass envuelto con normalización 403 (backup:', bak, ')');
}
