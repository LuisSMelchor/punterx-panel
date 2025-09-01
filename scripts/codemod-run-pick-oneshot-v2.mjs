import fs from 'fs';

const file = 'netlify/functions/run-pick-oneshot.cjs';
let src = fs.readFileSync(file, 'utf8');

const hasAiRequire = /const\s+__ai\s*=\s*\(\(\)\s*=>\s*\{\s*try\s*\{\s*return\s+require\(['"]\.\/_lib\/ai\.cjs['"]\);\s*\}\s*catch\(_\)\s*\{\s*return\s+null;\s*\}\}\)\(\);/s.test(src);
const hasHelper = /function\s+_coerceAI\s*\(/s.test(src);
if (!hasHelper) {
  const helper = `
function _coerceAI(aiResp, __ai){
  try {
    if (!aiResp) return null;
    if (aiResp.json && typeof aiResp.json === "object") return aiResp.json;
    const sj = (__ai && typeof __ai.safeJson === 'function') ? __ai.safeJson : null;
    if (aiResp.content && sj) return sj(aiResp.content);
    return null;
  } catch(_) { return null; }
}
`;
  if (hasAiRequire) {
    src = src.replace(/(require\(['"]\.\/_lib\/ai\.cjs['"]\)\);?)/, `$1\n${helper}`);
  } else {
    src = src.replace(/^('use strict';)/m,
      `$1\nconst __ai = (()=>{ try { return require('./_lib/ai.cjs'); } catch(_) { return null; }})();\n${helper}`);
  }
}

if (!/const\s+aiJson\s*=\s*_coerceAI\(/s.test(src)) {
  const reAssign = /const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[A-Za-z_$][\w$]*\.callOpenAIOnce\s*\(/;
  const m = src.match(reAssign);
  if (m) {
    const varName = m[1];
    const start = m.index;
    const rest = src.slice(start);
    const semi = rest.indexOf(';');
    if (semi !== -1) {
      const insertAt = start + semi + 1;
      src = src.slice(0, insertAt) + `\nconst aiJson = _coerceAI(${varName}, __ai);` + src.slice(insertAt);
    }
  }
}

fs.writeFileSync(file, src, 'utf8');
console.log('[codemod-v2] Patched run-pick-oneshot.cjs');
