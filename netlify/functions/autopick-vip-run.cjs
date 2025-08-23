'use strict';
exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    // Prueba rápida: no toca la implementación real
    if (qs.smoke === '1') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, stage: 'run.smoke', debug: qs.debug === '1' })
      };
    }

    const mod = require('./autopick-vip-nuevo-impl.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, stage: 'run-wrapper', error: 'handler no encontrado' })
      };
    }

    // Inyectar AUTH para cron (si falta) y detectar scheduled
    const expected = (process.env.AUTH_CODE || '').trim();
    const inHeaders = (event && event.headers) ? { ...event.headers } : {};
    if (expected && !inHeaders['x-auth-code']) inHeaders['x-auth-code'] = expected;

    const isScheduled =
      !!(inHeaders['x-nf-schedule-id'] || inHeaders['x-nf-schedule-trigger'] || inHeaders['x-nf-schedule']);

    // Forzar ruta manual y debug cuando es scheduled (o si el caller ya pide debug)
    const newQs = { manual: '1' };
    if (isScheduled || qs.debug === '1') newQs.debug = '1';

    const newEvent = { ...(event || {}), headers: inHeaders, queryStringParameters: newQs };
    const resp = await mod.handler(newEvent, context);

    // Normalizar a JSON por si la impl no pone content-type
    if (!resp || typeof resp !== 'object') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, stage: 'run-wrapper', error: 'respuesta inválida del impl' })
      };
    }
    const ct = (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || '';
    if (!/application\/json/i.test(ct)) {
      resp.headers = { ...(resp.headers || {}), 'content-type': 'application/json' };
      if (typeof resp.body !== 'string') resp.body = JSON.stringify(resp.body || { ok: true });
    }
    return resp;

  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        stage: 'run-wrapper',
        error: String(e && (e.message || e)),
        stack: e && e.stack ? String(e.stack) : null
      })
    };
  }
};
