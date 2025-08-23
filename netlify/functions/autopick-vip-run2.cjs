'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj)
});

exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};

    // Ping temprano para comprobar que el archivo carga
    if (qs && qs.ping === '1') {
      return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)' });
    }

    // Carga perezosa de la implementación real
    let impl;
    try {
      impl = require('./autopick-vip-nuevo-impl.cjs');
    } catch (e) {
      return __json(200, { ok: false, fatal: true, stage: 'require(impl)', error: String((e && e.message) || e) });
    }

    if (impl && typeof impl.handler === 'function') {
      const res = await impl.handler(event, context);
      if (!res || typeof res.statusCode !== 'number') {
        return __json(200, { ok: false, stage: 'impl', error: 'Respuesta inválida de impl' });
      }
      return res;
    }

    return __json(200, { ok: false, fatal: true, error: 'impl.handler no encontrado' });
  } catch (e) {
    return __json(200, { ok: false, fatal: true, stage: 'wrapper', error: String((e && e.message) || e) });
  }
};
