'use strict';
const fs = require('fs');

const files = [
  'netlify/functions/diag-impl-call.cjs',
  'netlify/functions/autopick-vip-run3.cjs',
];

function replaceIsDebugBlock(src) {
  const marker = 'function isDebug(event)';
  const i = src.indexOf(marker);
  if (i < 0) return { src, changed: false, note: 'no isDebug found' };

  // encontrar el '{' que abre la función y balancear llaves hasta su cierre
  const openIdx = src.indexOf('{', i);
  if (openIdx < 0) return { src, changed: false, note: 'no opening brace for isDebug' };

  let j = openIdx + 1, depth = 1;
  while (j < src.length && depth > 0) {
    const ch = src[j++];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth !== 0) return { src, changed: false, note: 'unbalanced braces in isDebug' };

  const endIdx = j; // posición después del '}' de cierre

  const newBlock =
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

  let out = src.slice(0, i) + newBlock + src.slice(endIdx);

  // Limpieza defensiva: eliminar posibles restos exactos del bloque viejo si quedaron colgando
  out = out
    .replace(/\n\s*const\s+h\s*=\s*getHeaders\(event\);\s*\n\s*const\s+token\s*=\s*process\.env\.DEBUG_TOKEN[^\n]*\n\s*const\s+allowed\s*=\s*isDebug\(event\)[^\n]*\n\s*return\s+q\.debug[^\n]*\n\s*\}\s*/m, '\n');

  return { src: out, changed: true, note: 'isDebug replaced' };
}

function ensureAllowedInHandler(src) {
  const hIdx = src.indexOf('exports.handler');
  if (hIdx < 0) return { src, changed: false, note: 'no handler found' };
  const qIdx = src.indexOf('const q', hIdx);
  if (qIdx < 0) return { src, changed: false, note: 'no const q in handler' };

  // encontrar fin de línea de la declaración de q (hasta ';')
  const semiIdx = src.indexOf(';', qIdx);
  if (semiIdx < 0) return { src, changed: false, note: 'no semicolon after const q' };

  // si ya existe allowed cerca, no duplicar
  const afterQ = src.slice(semiIdx, semiIdx + 200);
  if (/const\s+allowed\s*=\s*isAllowed\(event\)/.test(afterQ)) {
    return { src, changed: false, note: 'allowed already present' };
  }

  const injected = src.slice(0, semiIdx + 1) + `\n  const allowed = isAllowed(event);` + src.slice(semiIdx + 1);
  return { src: injected, changed: true, note: 'allowed inserted' };
}

for (const file of files) {
  const orig = fs.readFileSync(file, 'utf8');

  let cur = orig, notes = [];

  // Paso 1: reemplazar bloque isDebug completo por versión segura + isAllowed
  const r1 = replaceIsDebugBlock(cur);
  cur = r1.src; notes.push(r1.note);

  // Paso 2: insertar allowed tras const q = ...
  const r2 = ensureAllowedInHandler(cur);
  cur = r2.src; notes.push(r2.note);

  // Paso 3: sanity simple — no dejar patrones viejos de allowed dentro de isDebug
  if (/isDebug\(event\)\s*&&\s*token\s*&&\s*h\['x-debug-token'\]\s*===\s*token/.test(cur)) {
    notes.push('WARNING: leftover old allowed pattern detected; cleaning');
    cur = cur.replace(/isDebug\(event\)\s*&&\s*token\s*&&\s*h\['x-debug-token'\]\s*===\s*token/g, 'false /* cleaned */');
  }

  // Guardar si hubo cambios
  if (cur !== orig) {
    const bak = `${file}.bak.${Date.now()}`;
    fs.writeFileSync(bak, orig, 'utf8');
    fs.writeFileSync(file, cur, 'utf8');
    console.log(`[AF_DEBUG] ${file}: patched (${notes.join('; ')}) (backup: ${bak})`);
  } else {
    console.log(`[AF_DEBUG] ${file}: no changes (${notes.join('; ')})`);
  }
}
