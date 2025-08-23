'use strict';

// JSON helper (evita 500; siempre respondemos JSON)
const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj)
});

// Handler a prueba de fallos (sin requires arriba)
exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};

    // Ping temprano: confirma que el archivo carga
    if (qs.ping === '1') {
      return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)' });
    }

    // TODO real: carga perezosa de la implementación
    // Si esto falla (ESM/ENV/etc), devolvemos JSON con error (NO 500)
    let impl;
    try {
      impl = require('./autopick-vip-nuevo-impl.cjs');
    } catch (e) {
      return __json(200, {
        ok: false,
        fatal: true,
        stage: 'require(impl)',
        error: String((e && e.message) || e)
      });
    }

    if (impl && typeof impl.handler === 'function') {
      const res = await impl.handler(event, context);
      // Si la impl no devuelve formato Netlify, lo normalizamos
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
