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
    let headers = (event && event.headers) || {};
    const isScheduled = !!headers['x-nf-scheduled'];
    const debug = qbool(qs.debug);

    // 0) PING (siempre 200 JSON)
    if (qbool(qs.ping)) {
      return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)', scheduled: isScheduled });
    }

    // 0.1) DEBUG FS: listar __dirname o LAMBDA_TASK_ROOT ANTES de cargar el impl
    if (qbool(qs.ls) || qbool(qs.lsroot)) {
      try {
        const rq = eval('require');
        const _fs = rq('fs');
        const dir = qbool(qs.lsroot) && process.env.LAMBDA_TASK_ROOT
          ? process.env.LAMBDA_TASK_ROOT
          : __dirname;
        const files = _fs.readdirSync(dir).sort();
        return __json(200, { ok: true, dir, __dirname, LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT || null, files });
      } catch (e) {
        return __json(200, { ok: false, stage: 'ls', error: (e && e.message) || String(e) });
      }
    }

    // 1) Carga diferida del impl (evita crash por ESM/CJS en top-level)
    let impl;
    try {
      const rq = eval('require');                    // evita bundling en frío
      const path = rq('path');
      const fsx = rq('fs');

      // Ruta 1: impl junto a la función (zisi suele dejar /var/task/netlify/functions/)
      let implPath = path.join(__dirname, 'autopick-vip-nuevo-impl.cjs');
      if (!fsx.existsSync(implPath) && process.env.LAMBDA_TASK_ROOT) {
        // Ruta 2: raíz del bundle (esbuild suele dejar /var/task/)
        const alt = path.join(process.env.LAMBDA_TASK_ROOT, 'netlify/functions', 'autopick-vip-nuevo-impl.cjs');
        if (fsx.existsSync(alt)) implPath = alt;
      }

      impl = rq(implPath);
    } catch (e) {
      return __json(200, {
        ok: false,
        fatal: true,
        stage: 'require(impl)-eval',
        error: (e && e.message) || String(e),
        stack: debug && e && e.stack ? String(e.stack) : undefined,
      });
    }

    // 2) Preparar evento delegado (inyecta auth cuando es cron o manual)
    const inHeaders = Object.assign({}, headers);
    // Inyecta AUTH en todas las variantes que podría leer el impl
    if ((isScheduled || qbool(qs.manual)) && process.env.AUTH_CODE) {
      inHeaders["x-auth"] = process.env.AUTH_CODE;
      inHeaders["x-auth-code"] = process.env.AUTH_CODE;
      inHeaders["authorization"] = "Bearer " + process.env.AUTH_CODE;
      inHeaders["x-api-key"] = process.env.AUTH_CODE;
    }
    // Propaga YA al wrapper, para que el gate de auth las vea
    headers = inHeaders;
    try { event.headers = inHeaders } catch(e) {}
    if ((isScheduled || qbool(qs.manual)) && process.env.AUTH_CODE) {
      inHeaders['x-auth'] = process.env.AUTH_CODE;
      inHeaders['x-auth-code'] = process.env.AUTH_CODE;
    }

    // Forzar modo manual si viene scheduled o ?manual=1
    const forceManual = isScheduled || qbool(qs.manual);
    if (debug) {
      try {
        const seen = { xauth: headers["x-auth"], xauthc: headers["x-auth-code"] };
      } catch {}
    }
    const newQs = Object.assign({}, qs);
    if (forceManual) {
      newQs.manual = '1';
      if (debug) newQs.debug = '1';
    }

    const newEvent = Object.assign({}, event, {
      headers: inHeaders,
      queryStringParameters: newQs,
    });

    // 3) Delegar a impl.handler con manejo de errores y salida JSON garantizada
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

    // 4) Normalizar salida a JSON
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
    return __json(200, { ok: false, fatal: true, stage: 'wrapper.catch', error: (e && e.message) || String(e) });
  }
};
