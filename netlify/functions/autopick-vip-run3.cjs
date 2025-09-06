'use strict';


let impl;
// Ruta: /.netlify/functions/autopick-vip-run3
exports.handler = async (event, context) => {
  const qs = (event && event.queryStringParameters) || {};
  if ('ping' in qs) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ping: 'autopick-vip-run3 (pong)' }) };
  }
  /* DYNAMIC_IMPL_REQUIRE_V1 */
  (function(){
    const rq = eval('require');
    const candidates = [
      process.cwd() + '/netlify/functions/_lib/autopick-vip-nuevo-impl.cjs',
      __dirname + '/_lib/autopick-vip-nuevo-impl.cjs',
      __dirname + '/../functions/_lib/autopick-vip-nuevo-impl.cjs'
    ];
    for (const c of candidates) {
      try { impl = rq(c); if (impl) break; } catch(_) {}
    }
  })();

  if (typeof impl === 'function') impl = { handler: impl };
  if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };
  // IMPL_NORMALIZE_SHAPE_V1
  if (impl && typeof impl === 'function') impl = { handler: impl };
  else if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };


  if (!impl || typeof impl.handler !== 'function') {
    return { statusCode: 200, body: JSON.stringify({ ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado' }) };
  }

  try {
    const res = await impl.handler(event, context);
    if (!res || typeof res.statusCode !== 'number') {
      return { statusCode: 200, body: JSON.stringify(res && typeof res === 'object' ? res : { ok: !!res }) };
    }
    return res;
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, stage: 'impl.call', error: (e && e.message) || String(e) }) };
  }
};
