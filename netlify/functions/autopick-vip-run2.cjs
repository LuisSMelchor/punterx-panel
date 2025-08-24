'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});

const qbool = (v) => v === '1' || v === 'true' || v === 'yes';

exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    const headers = (event && event.headers) || {};
    const isScheduled = !!headers['x-nf-scheduled'];
    const debug = qbool(qs.debug);

    // 1) Ping
    if (qbool(qs.ping)) {
      return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)', scheduled: isScheduled });
    }

    // 2) Carga diferida del impl (versión simple)
    let impl;
    try {
      impl = require('./autopick-vip-nuevo-impl.cjs');
    } catch (e) {
      return __json(200, {
        ok: false, fatal: true, stage: 'require(impl)',
        error: (e && e.message) || String(e),
        stack: debug && e && e.stack ? String(e.stack) : undefined,
      });
    }

    // 3) Delegación directa
    if (!impl || typeof impl.handler !== 'function') {
      return __json(200, { ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado' });
    }

    let res;
    try {
      res = await impl.handler(event, context);
    } catch (e) {
      return __json(200, {
        ok: false, stage: 'impl.call',
        error: (e && e.message) || String(e),
        stack: debug && e && e.stack ? String(e.stack) : undefined,
      });
    }

    if (!res || typeof res.statusCode !== 'number') {
      return __json(200, { ok: false, stage: 'impl.response', error: 'Respuesta inválida de impl' });
    }
    // Fuerza JSON si no viene marcado
    if (!res.headers || String(res.headers['content-type'] || '').indexOf('application/json') === -1) {
      try {
        const parsed = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        return __json(res.statusCode || 200, parsed);
      } catch {
        return __json(200, { ok: false, stage: 'impl.response', error: 'impl devolvió body no-JSON' });
      }
    }
    return res;
  } catch (e) {
    return __json(200, { ok: false, fatal: true, stage: 'wrapper.catch', error: (e && e.message) || String(e) });
  }
};
