import fs from 'fs';

function patch(file) {
  let src = fs.readFileSync(file, 'utf8');
  const needsSR2 = /\bsend_report2\b/.test(src) && !/(?:^|\n)\s*(?:const|let|var)\s+send_report2\b/.test(src);
  const alreadyRequireMeta = /require\(['"]\.\/_lib\/meta\.cjs['"]\)/.test(src);
  if (!needsSR2) {
    console.log('[codemod-sr] skip', file, '(no TDZ risk or already declared)');
    return;
  }

  const inject = `
let send_report = null, send_report2 = null, send_report3 = null;
try { ({ send_report, send_report2, send_report3 } = require('./_lib/meta.cjs')); } catch (_) {}
if (typeof send_report !== 'function')  { send_report  = () => ({ enabled:false, results:[] }); }
if (typeof send_report2 !== 'function') { send_report2 = send_report; }
if (typeof send_report3 !== 'function') { send_report3 = send_report; }
`.trim();

  // Insertar tras 'use strict';
  src = src.replace(/^('use strict';)/m, `$1\n${inject}\n`);
  fs.writeFileSync(file, src, 'utf8');
  console.log('[codemod-sr] Patched', file);
}

const files = process.argv.slice(2);
for (const f of files) patch(f);
