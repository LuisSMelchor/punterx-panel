'use strict';
// [WRAPPER_MIN_V1] PunterX · Autopick VIP Run2 — tiny delegator

exports.handler = async (event, context) => {
  const qs = (event && event.queryStringParameters) || {};
  const ping = Object.prototype.hasOwnProperty.call(qs, 'ping');
  const isScheduled = !!(context && (context.scheduled || context.invocationType === 'scheduled'));

  if (ping) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ping: 'autopick-vip-run2 (pong)', scheduled: isScheduled })
    };
  }

  // Carga impl
  let impl = require('./_lib/autopick-vip-nuevo-impl.cjs');
  if (impl && typeof impl === 'function') impl = { handler: impl };
  else if (impl && impl.default && typeof impl.default === 'function') impl = { handler: impl.default };

  if (!impl || typeof impl.handler !== 'function') {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, fatal: true, stage: 'impl', error: 'impl.handler no encontrado' })
    };
  }

  // (Opcional) inyecta AUTH al volar cuando corre por cron o ?manual=1
  const headersIn = Object.assign({}, (event && event.headers) || {});
  if ((isScheduled || qs.manual === '1') && process.env.AUTH_CODE) {
    headersIn['x-auth'] = process.env.AUTH_CODE;
    headersIn['x-auth-code'] = process.env.AUTH_CODE;
    headersIn['authorization'] = 'Bearer ' + process.env.AUTH_CODE;
    headersIn['x-api-key'] = process.env.AUTH_CODE;
  }

  const newEvent = Object.assign({}, event, { headers: headersIn });

  try {
    const res = await impl.handler(newEvent, context);
    if (!res || typeof res.statusCode !== 'number') {
      return { statusCode: 200, body: JSON.stringify(res && typeof res === 'object' ? res : { ok: !!res }) };
    }
    return res;
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, stage: 'impl.call', error: (e && e.message) || String(e) }) };
  }
};
