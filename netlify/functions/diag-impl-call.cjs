'use strict';

// --- begin: harden JSON output ---
function jsonifyResponse(x){
  if (x && typeof x === 'object' && 'statusCode' in x && 'body' in x) return jsonifyResponse(x);
  const body = (x === undefined) ? { ok:true } : x;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
// --- end: harden JSON output ---
// diag-impl-call: delegator robusto con inspect
exports.handler = async (event, context) => {
  const qs = (event && event.queryStringParameters) || {};
  if ('ping' in qs) return { statusCode: 200, body: JSON.stringify({ ok: true, ping: 'diag-impl-call (pong)', requireTrace: __trace.slice(-300) }) };

  // --- dynamic require con candidates + declaración de impl ---
  let impl;
  const rq = eval('require');
  const fsx = rq('fs');
  const p = rq('path');

  
  /* REQUIRE_TRACE_V1 */
  const Module = rq('module');
  const __origLoad = Module._load;
  const __trace = [];
  const __loading = [];
  Module._load = function(request, parent, isMain){
    let resolved;
    try {
      resolved = Module._resolveFilename(request, parent, isMain);
    } catch(_) {
      resolved = request;
    }
    const parentFile = parent && parent.filename;
    const circular = __loading.includes(resolved);
    __trace.push({ request, resolved, parent: parentFile, circular });
    __loading.push(resolved);
    try { return __origLoad.apply(this, arguments); }
    finally { __loading.pop(); }
  };
      const candidates = [
    p.join(process.cwd(), 'netlify/functions/_lib/autopick-vip-nuevo-impl.cjs'),
    p.join(__dirname, '_lib/autopick-vip-nuevo-impl.cjs'),
    p.join(__dirname, '../functions/_lib/autopick-vip-nuevo-impl.cjs'),
    '/var/task/netlify/functions/_lib/autopick-vip-nuevo-impl.cjs',
    '/var/task/_lib/autopick-vip-nuevo-impl.cjs'
  ];

  const tried = [];
  let resolved = null;
  for (const c of candidates) {
    try {
      if (!fsx.existsSync(c)) { tried.push({ c, exists: false }); continue; }
      impl = rq(c);
      resolved = c;
      if (process.env.AF_DEBUG) console.log('[AF_DEBUG]', 'diag-impl-call', 'impl resolved at', c, 'keys=', (impl && Object.keys(impl)||[]));
      break;
    } catch (e) {
      tried.push({ c, exists: true, err: (e && (e.message||String(e))) });
    }
  }

  // normaliza shape
  // Fallback require plano si todo falló (bundle zisi expone vecinos en /var/task)
  if (!resolved) {
    try {
      const direct = './_lib/autopick-vip-nuevo-impl.cjs';
      impl = rq(direct); resolved = direct;
      if (process.env.AF_DEBUG) console.log('[AF_DEBUG] fallback require', direct, 'keys=', (impl && Object.keys(impl)||[]));
    } catch(_) {}
  }

  // normaliza shape
  if (impl && typeof impl === 'function') impl = { handler: impl };
  else if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };
  else if (impl && impl.default && typeof impl.default.handler === 'function') impl = { handler: impl.default.handler };

  // modo inspect
  if ('inspect' in qs) {
    const info = {
      ok: true,
      __dirname,
      cwd: process.cwd(),
      resolved,
      candidates,
      tried,
      type: typeof impl,
      keys: impl ? Object.keys(impl) : [],
      hasHandler: !!(impl && typeof impl.handler === 'function')
    };
    return { statusCode: 200, body: JSON.stringify(info) };
  }

  if (!impl || typeof impl.handler !== 'function') {
    return { statusCode: 200, body: JSON.stringify({ ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado', resolved, tried }) };
  }

  try {
    const res = await impl.handler(event, context);
    if (!res || typeof res.statusCode !== 'number') {
      return { statusCode: 200, body: JSON.stringify(res && typeof res === 'object' ? res : { ok: !!res }) };
    }
    return jsonifyResponse(res);
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, stage: 'impl.call', error: (e && e.message) || String(e) }) };
  }
};
