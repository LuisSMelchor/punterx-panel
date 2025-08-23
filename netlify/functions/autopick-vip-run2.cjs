'use strict';
exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};

    // smoke opcional
    if (qs.smoke === '1') {
      return {
        statusCode: 200,
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ ok:true, stage:'run2.smoke', debug: qs.debug === '1' })
      };
    }

    // Cargar la implementación real
    const mod = require('./autopick-vip-nuevo-impl.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return { statusCode:200, headers:{'content-type':'application/json'},
        body: JSON.stringify({ ok:false, stage:'run2.wrapper', error:'handler no encontrado' }) };
    }

    // Inyecta AUTH si falta (para scheduled)
    const expected = (process.env.AUTH_CODE || '').trim();
    const inHeaders = (event && event.headers) ? { ...event.headers } : {};
    if (expected && !inHeaders['x-auth-code'] && !inHeaders['x-auth']) {
      inHeaders['x-auth-code'] = expected;
    }

    // Fuerza manual=1 (misma ruta de logs que usas) y preserva debug
    const newQs = { manual:'1' };
    if (qs.debug === '1') newQs.debug = '1';

    const newEvent = { ...(event||{}), headers: inHeaders, queryStringParameters: newQs };

    // Delegar
    return await mod.handler(newEvent, context);

  } catch (e) {
    return { statusCode:200, headers:{'content-type':'application/json'},
      body: JSON.stringify({ ok:false, stage:'run2.catch', error:String(e && (e.message||e)), stack: e && e.stack ? String(e.stack): null }) };
  }
};
