// netlify/functions/autopick-vip-run2.cjs
// PunterX · Autopick VIP Run2 — wrapper con rutas ping/ls/lsroot y delegación al impl
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const qbool = (v) => v === '1' || v === 'true' || v === 'yes';

exports.handler = async (event, context) => {
  const qs = (event && event.queryStringParameters) || {};
  let headers = (event && event.headers) || {};
  const isScheduled = !!headers['x-nf-scheduled'];
  const debug = qbool(qs.debug);

  // PING rápido (respuesta de salud)
  if (qbool(qs.ping)) {
    return __json(200, { ok: true, ping: 'autopick-vip-run2 (pong)', scheduled: isScheduled });
  }

  // Debug FS: listar archivos en __dirname o LAMBDA_TASK_ROOT
  if (qbool(qs.ls) || qbool(qs.lsroot)) {
    try {
      const rq = eval('require');
      const fs = rq('fs');
      const dir = qbool(qs.lsroot) && process.env.LAMBDA_TASK_ROOT
        ? process.env.LAMBDA_TASK_ROOT
        : __dirname;
      const files = fs.readdirSync(dir).sort();
      return __json(200, { ok: true, dir, __dirname, LAMBDA_TASK_ROOT: process.env.LAMBDA_TASK_ROOT || null, files });
    } catch (e) {
      if (debug) console.log('[AF_DEBUG] ls error:', e && (e.message || e));
      return __json(200, { ok: false, stage: 'ls', error: (e && e.message) || String(e) });
    }
  }

  // Carga diferida del impl real
  let impl;
  try {
    const rq = eval('require');
    const path = rq('path');
    const fs = rq('fs');
    let implPath = path.join(__dirname, '_lib/autopick-vip-nuevo-impl.cjs');
    if (!fs.existsSync(implPath) && process.env.LAMBDA_TASK_ROOT) {
      const alt = path.join(process.env.LAMBDA_TASK_ROOT, 'netlify/functions', '_lib/autopick-vip-nuevo-impl.cjs');
      if (fs.existsSync(alt)) implPath = alt;
    }
    impl = rq(implPath);
  } catch (e) {
    if (debug) console.log('[AF_DEBUG] require impl error:', e && (e.message || e));
    return __json(200, { ok: false, fatal: true, stage: 'require(impl)', error: (e && e.message) || String(e) });
  }

  // Inyectar AUTH si es cron o manual (para que el impl lo acepte)
  const inHeaders = Object.assign({}, headers);
  if ((isScheduled || qbool(qs.manual)) && process.env.AUTH_CODE) {
    inHeaders['x-auth'] = process.env.AUTH_CODE;
    inHeaders['x-auth-code'] = process.env.AUTH_CODE;
    inHeaders['authorization'] = 'Bearer ' + process.env.AUTH_CODE;
    inHeaders['x-api-key'] = process.env.AUTH_CODE;
  }
  headers = inHeaders;
  try { event.headers = inHeaders; } catch (_) {}

  // Forzar modo manual cuando viene de cron o ?manual=1
  const newQs = Object.assign({}, qs);
  if (isScheduled || qbool(qs.manual)) {
    newQs.manual = '1';
    if (debug) newQs.debug = '1';
  }
  const newEvent = Object.assign({}, event, {
    headers: inHeaders,
    queryStringParameters: newQs,
  });

  // Delegar al handler del impl
  if (!impl || typeof impl.handler !== 'function') {
    return __json(200, { ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado' });
  }
  try {
    const res = await impl.handler(newEvent, context);
    if (!res || typeof res.statusCode !== 'number') {
      // Normalizar salida si impl retornó algo no estándar
      return __json(200, (res && typeof res === 'object') ? res : { ok: !!res });
    }
    return res;
  } catch (e) {
    if (debug) console.log('[AF_DEBUG] impl.call error:', e && (e.stack || e.message || e));
    return __json(200, { ok: false, stage: 'impl.call', error: (e && e.message) || String(e) });
  }
};
