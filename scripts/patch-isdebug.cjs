'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  // 1) Evitar doble parche
  if (src.includes('function isAllowed(event)')) {
    console.log(`[AF_DEBUG] ${file}: ya tiene isAllowed, skip`);
    continue;
  }

  // 2) Reemplazar bloque function isDebug(...) { ... } por versión sin recursión
  const rxIsDebug = /function\s+isDebug\s*\(\s*event\s*\)\s*\{[\s\S]*?\}/m;
  const newIsDebug =
`function isDebug(event){
  const q = (event && event.queryStringParameters) || {};
  const h = getHeaders(event);
  // Solo detecta modo debug (no valida token aquí)
  return (q.debug === '1') || (h['x-debug'] === '1');
}
function isAllowed(event){
  // Gating seguro: requiere debug activo + coincidencia exacta de token
  const h = getHeaders(event);
  const token = process.env.DEBUG_TOKEN || "";
  if (!token) return false;
  return isDebug(event) && (h['x-debug-token'] === token);
}`;

  if (!rxIsDebug.test(src)) {
    console.error(`[AF_DEBUG] ${file}: no encontré bloque function isDebug(event){...}`);
    process.exitCode = 1;
    continue;
  }

  let out = src.replace(rxIsDebug, newIsDebug);

  // 3) Asegurar declaración de allowed en handler (antes de usarlo)
  // Insertamos "const allowed = isAllowed(event);" tras 'const q = ...'
  const rxQ = /(exports\.handler\s*=\s*async\s*function\s*\(\s*event\s*,\s*context\s*\)\s*\{\s*[\r\n]+\s*const\s+q\s*=\s*\(event.*?\);\s*)/m;
  if (rxQ.test(out)) {
    out = out.replace(rxQ, (_, head) => `${head}\n  const allowed = isAllowed(event);\n`);
  } else {
    console.error(`[AF_DEBUG] ${file}: no pude insertar 'const allowed' tras 'const q = ...'`);
    process.exitCode = 1;
  }

  // 4) Guardar backup e implementar
  const bak = `${file}.bak.${Date.now()}`;
  fs.writeFileSync(bak, src, 'utf8');
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[AF_DEBUG] ${file}: parche aplicado (backup: ${bak})`);
}
