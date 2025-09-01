import fs from 'fs';
const file = 'netlify/functions/oneshot-publish.cjs';
let src = fs.readFileSync(file, 'utf8');
let changed = false;

// borra bloques "function send_report2(...) { ... }" y "function send_report3(...) { ... }"
src = src.replace(/^\s*function\s+send_report2\s*\([^)]*\)\s*\{[\s\S]*?\}\s*$/m, (m)=>{ changed=true; return `/* removed: send_report2 local dup */`;});
src = src.replace(/^\s*function\s+send_report3\s*\([^)]*\)\s*\{[\s\S]*?\}\s*$/m, (m)=>{ changed=true; return `/* removed: send_report3 local dup */`;});

if (changed) {
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-publish-dedupe] Patched', file);
} else {
  console.log('[codemod-publish-dedupe] skip (no local dup functions)');
}
