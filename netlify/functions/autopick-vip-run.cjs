'use strict';
exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    // BYPASS de humo: si viene ?smoke=1, responde y no llama al impl
    if (qs.smoke === '1') {
      return { statusCode:200, headers:{'content-type':'application/json'},
        body: JSON.stringify({ ok:true, stage:'run.smoke', got:{ debug:qs.debug||'0' } }) };
    }

    // Cargar impl y validar
    const mod = require('./autopick-vip-nuevo-impl.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return { statusCode:200, headers:{'content-type':'application/json'},
        body: JSON.stringify({ ok:false, stage:'run-wrapper', error:'handler no encontrado' }) };
    }

    // Sanear SIEMPRE el query: ignorar cron/tick y forzar manual=1 (preservar debug)
    const newQs = { manual:'1' };
    if (qs.debug === '1') newQs.debug = '1';

    const newEvent = { ...(event||{}), queryStringParameters:newQs };
    return await mod.handler(newEvent, context);

  } catch (e) {
    return { statusCode:200, headers:{'content-type':'application/json'},
      body: JSON.stringify({ ok:false, stage:'run-wrapper', error:String(e && (e.message||e)), stack:e && e.stack ? String(e.stack):null }) };
  }
};
