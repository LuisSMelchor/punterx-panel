// netlify/functions/autopick-vip-scheduler.js
// Wrapper programado en CommonJS que invoca run2 cada 15 minutos

const run2 = require('./autopick-vip-run2.cjs');

exports.config = {
  schedule: "*/15 * * * *"
};

exports.default = async (req) => {
  const event = {
    headers: { 'x-nf-scheduled': '1' },
    queryStringParameters: { manual: '1' }
  };
  const context = {};

  const res = await run2.handler(event, context);
  const body = (res && res.body) ? res.body : JSON.stringify({ ok: true, via: 'autopick-vip-scheduler' });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
};
