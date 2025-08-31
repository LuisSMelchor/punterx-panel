import fs from 'fs';

const file = 'netlify/functions/run-pick-oneshot.cjs';
let src = fs.readFileSync(file, 'utf8');

const hasHelper = /function\s+_coerceAI\s*\(/s.test(src);
const aiRequireLine = src.match(/require\(['"]\.\/_lib\/ai\.cjs['"]\)\);?/);

function insertHelper(s) {
  const helper =
`
function _coerceAI(aiResp, __ai){
  try {
    if (!aiResp) return null;
    if (aiResp.json && typeof aiResp.json === "object") return aiResp.json;
    // preferimos safeJson del propio módulo si existe
    const sj = (__ai && typeof __ai.safeJson === 'function') ? __ai.safeJson : null;
    if (aiResp.content && sj) return sj(aiResp.content);
    return null;
  } catch(_) { return null; }
}
`;
  if (hasHelper) return s;
  if (aiRequireLine) {
    // Inserta después de la primera require('./_lib/ai.cjs')
    return s.replace(/(require\(['"]\.\/_lib\/ai\.cjs['"]\)\);?)/, `$1\n${helper}`);
  }
  // Si no hay require, lo añadimos tras 'use strict';
  return s.replace(/^('use strict';)/m, `$1\nconst __ai = (()=>{ try { return require('./_lib/ai.cjs'); } catch(_) { return null; }})();\n${helper}`);
}

// Inserta helper si falta
src = insertHelper(src);

// 2) Insertar "const aiJson = _coerceAI(VAR, __ai);" tras la primera llamada a callOpenAIOnce
// Captura el nombre de variable a la que se asigna la respuesta (aiResp, resp, etc.)
if (!/const\s+aiJson\s*=\s*_coerceAI\(/.test(src)) {
  // Busca patrón: const <var> = await (algo.)?callOpenAIOnce(
  const reAssign = /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[A-Za-z_$][\w$]*\.callOpenAIOnce\s*\(/;
  const m = src.match(reAssign);
  if (m) {
    const varName = m[1];
    // Inserta al final de la línea donde se cierra la llamada; buscamos el primer ';' después del match
    const startIndex = m.index;
    const rest = src.slice(startIndex);
    const semiIndex = rest.indexOf(';');
    if (semiIndex !== -1) {
      const globalIndex = startIndex + semiIndex + 1;
      src = src.slice(0, globalIndex) + `\nconst aiJson = _coerceAI(${varName}, __ai);` + src.slice(globalIndex);
    }
  }
}

// 3) Sustituir JSON.parse(...) por safeJson del módulo (suave, solo en este archivo)
src = src.replace(/JSON\.parse\s*\(/g, "(__ai && __ai.safeJson ? __ai.safeJson(");

// Arreglo de paréntesis: el replace anterior abrió un paréntesis extra,
// cerramos si detectamos un desbalance sencillo en las llamadas más comunes.
src = src.replace(/(__ai && __ai\.safeJson \? __ai\.safeJson\(([^)]+)\))/g, "$1");

// 4) Guardar
fs.writeFileSync(file, src, 'utf8');
console.log('[codemod] Patched run-pick-oneshot.cjs');
