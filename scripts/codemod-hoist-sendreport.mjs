import fs from 'fs';

function patch(file) {
  let src = fs.readFileSync(file,'utf8');
  let changed = false;

  // 1) eliminar declaraciones posteriores de let/const/var send_report* (dejaremos solo el prelude)
  const declRe = /^\s*(?:let|const|var)\s+(?:send_report(?:2|3)?)(?:\s*=.*)?;?\s*$/mg;
  if (declRe.test(src)) { src = src.replace(declRe, ''); changed = true; }

  // 2) insertar prelude hoisted tras 'use strict';
  const prelude =
`var send_report = null, send_report2 = null, send_report3 = null;
try { ({ send_report, send_report2, send_report3 } = require('./_lib/meta.cjs')); } catch (_){}
if (typeof send_report !== 'function')  send_report  = () => ({ enabled:false, results:[] });
if (typeof send_report2 !== 'function') send_report2 = send_report;
if (typeof send_report3 !== 'function') send_report3 = send_report;`;

  if (!/send_report2\s*=\s*send_report;/.test(src)) {
    src = src.replace(/^('use strict';)/m, `$1\n${prelude}\n`);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, src, 'utf8');
    console.log('[codemod-hoist-sendreport] Patched', file);
  } else {
    console.log('[codemod-hoist-sendreport] skip', file);
  }
}

for (const f of process.argv.slice(2)) patch(f);
