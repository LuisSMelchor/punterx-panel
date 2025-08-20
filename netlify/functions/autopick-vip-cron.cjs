'use strict';
const { schedule } = require('@netlify/functions');

async function tick() {
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  const url  = `${base}/.netlify/functions/autopick-vip-nuevo?cron=1`;
  const headers = { 'x-auth-code': process.env.AUTH_CODE || '' };

  const res = await fetch(url, { headers, method: 'GET' });
  const text = await res.text();
  console.log('[cron→autopick-vip-nuevo]', res.status, text.slice(0, 240));
}

exports.handler = schedule('*/15 * * * *', async () => {
  try { await tick(); }
  catch (e) { console.error('[cron error]', e && (e.stack || e.message || e)); }
});
