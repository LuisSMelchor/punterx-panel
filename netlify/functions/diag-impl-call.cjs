'use strict';

// Ruta: /.netlify/functions/diag-impl-call
exports.handler = async (event, context) => {
  const qs = (event && event.queryStringParameters) || {};
  if ('ping' in qs) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, ping: 'diag-impl-call (pong)' }) };
  }

  let impl = require('./_lib/autopick-vip-nuevo-impl.cjs');
  if (typeof impl === 'function') impl = { handler: impl };
  if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };

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
