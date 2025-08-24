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

    // 1) Ping universal (siempre 200 JSON)
    if (qbool(qs.ping)) {
      return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)', scheduled: isScheduled });
    }

    // 2) Carga diferida del impl (evita crash por ESM/CJS en top-level)
    let impl;
    try {
      const rq = eval('require'); // clave para evitar bundling en frío
      impl = rq('./autopick-vip-nuevo-impl.cjs');
    } catch (e) {
      return __json(200, {
        ok: false,
        fatal: true,
        stage: 'require(impl)-eval',
        error: (e && e.message) || String(e),
        stack: debug && e && e.stack ? String(e.stack) : undefined,
      });
    }

    // 3) Preparar evento delegado (inyecta auth cuando es cron o manual)
    const inHeaders = Object.assign({}, headers);
    if ((isScheduled || qbool(qs.manual)) && process.env.AUTH_CODE) {
      inHeaders['x-auth'] = process.env.AUTH_CODE;
      inHeaders['x-auth-code'] = process.env.AUTH_CODE;
    }

    // Forzar modo manual si viene scheduled o ?manual=1
    const forceManual = isScheduled || qbool(qs.manual);
    const newQs = Object.assign({}, qs);
    if (forceManual) {
      newQs.manual = '1';
      if (debug) newQs.debug = '1';
    }

    const newEvent = Object.assign({}, event, {
      headers: inHeaders,
      queryStringParameters: newQs,
    });

    // 4) Delegar a impl.handler con manejo de errores y salida JSON garantizada
    if (!impl || typeof impl.handler !== 'function') {
      return __json(200, { ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado' });
    }

    let res;
    try {
      res = await impl.handler(newEvent, context);
    } catch (e) {
      return __json(200, {
        ok: false,
        stage: 'impl.call',
        error: (e && e.message) || String(e),
        stack: debug && e && e.stack ? String(e.stack) : undefined,
      });
    }

    // 5) Normalizar salida a JSON
    if (!res || typeof res.statusCode !== 'number') {
      return __json(200, { ok: false, stage: 'impl.response', error: 'Respuesta inválida de impl' });
    }
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
    return __json(200, {
      ok: false,
      fatal: true,
      stage: 'wrapper.catch',
      error: (e && e.message) || String(e),
    });
  }
};
