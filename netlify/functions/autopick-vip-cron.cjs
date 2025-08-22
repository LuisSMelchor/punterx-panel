'use strict';

async function tick () {
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  const tickTag = new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,12); // YYYYMMDDHHMM
  const url  = `${base}/.netlify/functions/autopick-vip-nuevo?cron=1&tick=${tickTag}`;
  const headers = { 'x-auth-code': process.env.AUTH_CODE || '' };
  const res = await fetch(url, { headers, method: 'GET' });
  const text = await res.text();
  console.log('[cron→autopick-vip-nuevo]', res.status, text.slice(0, 240));
}

exports.handler = async () => {
  const ctx = (process.env.CONTEXT || '').toLowerCase();
  if (ctx && ctx !== 'production') {
    console.log('[cron] skip — CONTEXT=', ctx);
    return { statusCode: 200, body: 'skipped' };
  }
  try { await tick(); return { statusCode: 200, body: 'ok' }; }
  catch (e) { console.error('[cron error]', e?.stack || e?.message || e); return { statusCode: 200, body: 'error' }; }
};
