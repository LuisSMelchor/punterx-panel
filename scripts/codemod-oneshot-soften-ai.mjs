import fs from 'fs';
const file = 'netlify/functions/run-pick-oneshot.cjs';
let s = fs.readFileSync(file,'utf8');
let changed = false;

/**
 * Estrategia:
 * - Si hay ramas que devuelven { ok:false, reason: 'invalid-ai-json' }, convertir a
 *   respuesta 200 con ok:true, reason:null y message_free = composeOneShotPrompt(payload).
 * - Si no encontramos esa rama exacta, inyectamos un fallback justo después del parseo de IA,
 *   cuando aiJson es falsy.
 */

// 1) Reescritura directa de la rama de error, si existe
let s2 = s.replace(
  /return\s+res\.status\(\s*200\s*\)\.json\(\s*\{\s*([^}]*)reason\s*:\s*['"]invalid-ai-json['"]([^}]*)\}\s*\)\s*;?/g,
  (_m, pre, post) =>
    `return res.status(200).json({ ${pre}reason: null${post}, ok: true, message_free: composeOneShotPrompt(payload) });`
);
if (s2 !== s) { s = s2; changed = true; }

// 2) Inyección de fallback si detectamos la típica variable ai/aiJson
if (/callOpenAIOnce\(/.test(s) && /const\s+ai(Json)?\b/.test(s) && !/message_free:\s*composeOneShotPrompt\(payload\)/.test(s)) {
  // Insertar tras la primera aparición de "const ai" o "const aiJson"
  s2 = s.replace(
    /(const\s+ai(?:Json)?[^\n]*\n)/,
    `$1\n// Fallback no-fatal si la IA no devuelve JSON utilizable\nif (!aiJson) {\n  return res.status(200).json({\n    ok: true,\n    reason: null,\n    markets_top3: markets || payload.markets || {},\n    payload,\n    message_free: composeOneShotPrompt(payload)\n  });\n}\n`
  );
  if (s2 !== s) { s = s2; changed = true; }
}

if (changed) {
  fs.writeFileSync(file, s, 'utf8');
  console.log('[codemod-oneshot-soften-ai] Patched', file);
} else {
  console.log('[codemod-oneshot-soften-ai] skip (ok/no-op)');
}
