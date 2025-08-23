// netlify/functions/autopick-vip-scheduler.js
// Programado cada 15m: invoca run2 con header x-nf-scheduled y manual=1

const run2 = require('./autopick-vip-run2.cjs');

exports.config = { schedule: "*/15 * * * *" };

exports.handler = async (event, context) => {
  try {
    const passthroughEvent = {
      ...event,
      headers: { ...(event && event.headers || {}), 'x-nf-scheduled': '1' },
      queryStringParameters: { ...(event && event.queryStringParameters || {}), manual: '1' }
    };

    const res = await run2.handler(passthroughEvent, context);

    // Si run2 ya devuelve objeto Netlify, lo pasamos tal cual
    if (res && typeof res.statusCode === 'number' && 'body' in res) {
      return res;
    }
    // Sino, respondemos JSON mínimo
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, via: 'scheduler', passthrough: !!res })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, stage: 'scheduler', error: e?.message || String(e) })
    };
  }
};
