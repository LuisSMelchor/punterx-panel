'use strict';

// /.netlify/functions/diag-lib-scan
// ?scan=1                -> escanea todos los .cjs en _lib/** (recomendado)
// ?mod=_lib/enrich.cjs   -> prueba un módulo concreto (ruta relativa a /var/task)

exports.handler = async (event) => {
  const rq = eval('require');
  const fs = rq('fs');
  const path = rq('path');

  const q = (event && event.queryStringParameters) || {};
  const wantScan = 'scan' in q;
  const modArg = q.mod;

  const libCandidates = [
    path.join(__dirname, '_lib'),
    path.join(__dirname, 'netlify/functions/_lib'),
    '/var/task/_lib',
    '/var/task/netlify/functions/_lib',
  ];
  const libDir = libCandidates.find(d => { try { return fs.statSync(d).isDirectory(); } catch (_) { return false; } }) || null;

  function safeRequire(absPath) {
    try {
      const m = rq(absPath);
      return {
        ok: true,
        resolved: absPath,
        type: typeof m,
        keys: m && Object.keys(m) || [],
        hasHandler: !!(m && m.handler),
      };
    } catch (e) {
      return {
        ok: false,
        resolved: absPath,
        err: (e && e.message) || String(e),
        stack: (e && e.stack) || null,
      };
    }
  }

  if (modArg) {
    let abs = modArg;
    if (!abs.startsWith('/')) abs = path.join('/var/task', modArg.replace(/^\.?\//,''));
    const result = safeRequire(abs);
    return { statusCode: 200, body: JSON.stringify({ ok: true, libDir, single: result }) };
  }

  if (wantScan) {
    if (!libDir) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'libDir not found', tried: libCandidates }) };
    }
    let files = [];
    try {
      files = fs.readdirSync(libDir).filter(f => f.endsWith('.cjs'));
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, error: 'readdir failed', libDir, err: e && e.message }) };
    }

    const results = [];
    for (const f of files) {
      const abs = path.join(libDir, f);
      results.push({ file: f, ...safeRequire(abs) });
    }
    const failed = results.filter(r => !r.ok);
    const passed = results.filter(r => r.ok);
    return { statusCode: 200, body: JSON.stringify({
      ok: true, libDir,
      summary: { total: results.length, failed: failed.length, passed: passed.length },
      failed,                 // aquí verás cuál explota y con qué stack/err
      passed: passed.slice(0, 8)
    }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, hint: 'use ?scan=1 or ?mod=_lib/xxx.cjs', libCandidates }) };
};
