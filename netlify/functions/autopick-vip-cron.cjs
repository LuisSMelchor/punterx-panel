'use strict';
const { schedule } = require('@netlify/functions');

async function tick() {
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  const url  = `${base}&tick=202508221958`;
  const headers = { 'x-auth-code': process.env.AUTH_CODE || '' };

  const res = await fetch(url, { headers, method: 'GET' });
  const text = await res.text();
  console.log('[cron→autopick-vip-nuevo]', res.status, text.slice(0, 240));
}

exports.handler = schedule('*/15 * * * *', async () => {
    // Evita ejecuciones duplicadas en deploy previews / branch deploys
    const ctx = (process.env.CONTEXT || '').toLowerCase();
    if (ctx && ctx !== 'production') {
      console.log('[cron] skip — CONTEXT=', ctx);
      return;
    }
    try { await tick(); }
  catch (e) { console.error('[cron error]', e && (e.stack || e.message || e)); }
});
