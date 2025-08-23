'use strict';
exports.handler = async (event, context) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    if (qs.cron) delete qs.cron;           // ignora cron siempre
    qs.manual = "1";                        // fuerza manual SIEMPRE
    if (event) event.queryStringParameters = qs;
  } catch (e) {}
try { const qs = (event && event.queryStringParameters) || {}; if (qs.cron) { qs.manual = "1"; delete qs.cron; } if (event) event.queryStringParameters = qs; } catch (e) {}
try {
    const mod = require('./autopick-vip-nuevo-impl.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return { statusCode:200, headers:{'content-type':'application/json'},
        body: JSON.stringify({ ok:false, stage:'wrapper', error:'handler no encontrado' }) };
    }
    return await mod.handler(event, context);
  } catch (e) {
    return { statusCode:200, headers:{'content-type':'application/json'},
      body: JSON.stringify({ ok:false, stage:'require_or_boot', error: String(e && (e.message||e)), stack: e && e.stack ? String(e.stack): null }) };
  }
};
