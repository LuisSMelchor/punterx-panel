'use strict';
exports.handler = async (event, context) => {
  try {
    const mod = require('./autopick-vip-nuevo-impl.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return { statusCode:200, headers:{'content-type':'application/json'},
        body: JSON.stringify({ ok:false, stage:'run-wrapper', error:'handler no encontrado' }) };
    }

    // Sanea SIEMPRE el query: ignora cron/tick y fuerza manual=1 (preserva debug si venía)
    const qs = (event && event.queryStringParameters) || {};
    const newQs = { manual: '1' };
    if (qs.debug === '1') newQs.debug = '1';

    const newEvent = { ...(event||{}), queryStringParameters: newQs };
    return await mod.handler(newEvent, context);

  } catch (e) {
    return { statusCode:200, headers:{'content-type':'application/json'},
      body: JSON.stringify({ ok:false, stage:'run-wrapper', error: String(e && (e.message||e)), stack: e && e.stack ? String(e.stack): null }) };
  }
};
