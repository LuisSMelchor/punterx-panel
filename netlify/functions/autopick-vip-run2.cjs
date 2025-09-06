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
      const fs = require('fs');
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
  let impl = require('./_lib/autopick-vip-nuevo-impl.cjs');
  
  try {
    const path = require('path');
    const candidates = [
      // dev local
      path.join(__dirname, '_lib/autopick-vip-nuevo-impl.cjs'),
      // layout netlify bundle
      path.join(__dirname, 'netlify/functions/_lib/autopick-vip-nuevo-impl.cjs'),
      // lambda task root
      process.env.LAMBDA_TASK_ROOT ? path.join(process.env.LAMBDA_TASK_ROOT, 'netlify/functions/_lib/autopick-vip-nuevo-impl.cjs') : null,
      // absolutos típicos en /var/task
      '/var/task/netlify/functions/_lib/autopick-vip-nuevo-impl.cjs',
      '/var/task/_lib/autopick-vip-nuevo-impl.cjs'
    ].filter(Boolean);
    for (const cand of candidates) {
  try {
    impl = require('./_lib/autopick-vip-nuevo-impl.cjs');
    if (process.env.AF_DEBUG) console.log('[AF_DEBUG] impl resolved at', cand, 'keys=', (impl && Object.keys(impl)) );
    if (impl) break;
  } catch(_) {}
}
  } catch(_) {}
try {
    const rq = eval('require');
    const path = require('path');
    const fs = require('fs');
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
// [IMPL_NORMALIZE_V1] normalize shapes of the impl export
if (impl && typeof impl === 'function') {
  impl = { handler: impl };
} else if (impl && typeof impl.handler !== 'function' && typeof impl.default === 'function') {
  impl = { handler: impl.default };
} else if (impl && typeof impl.handler !== 'function') {
  const aliases = ['run','main','execute','handle','start'];
  for (const k of aliases) {
    if (typeof impl[k] === 'function') { impl = { handler: impl[k] }; break; }
  }
}
if (process.env.AF_DEBUG) try { console.log('[AF_DEBUG] impl normalize keys=', Object.keys(impl||{})); } catch {}
// [IMPL_NORMALIZE_FINAL]
if (impl && typeof impl === 'function') impl = { handler: impl };
else if (impl && typeof impl.handler === 'function') { /* ok */ }
else if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };
else if (impl && impl.default && typeof impl.default.handler === 'function') impl = { handler: impl.default.handler };
else if (impl) {
  const funcs = Object.entries(impl).filter(([k,v]) => typeof v === 'function');
  if (funcs.length === 1) impl = { handler: funcs[0][1] };
}


  
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
