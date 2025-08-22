// netlify/functions/autopick-vip-cron.cjs
'use strict';

async function tick() {
  const base = process.env.URL || process.env.DEPLOY_URL || '';
  // agregamos tick para que quede trazable unid: YYYYMMDDHHmm
  const now = new Date();
  const tickId = now.toISOString().slice(0,16).replace(/[-:T]/g,''); // YYYYMMDDHHmm
  const url  = `${base}/.netlify/functions/autopick-vip-nuevo?cron=1&tick=${tickId}`;

  const headers = { 'x-auth-code': process.env.AUTH_CODE || '' };
  const res = await fetch(url, { headers, method: 'GET' });
  const text = await res.text();
  console.log('[cron→autopick-vip-nuevo]', res.status, text.slice(0, 240));
}

exports.handler = async (event) => {
  // Este handler se ejecuta solo cuando Netlify lo llama (cron vía netlify.toml),
  // o si lo invocas por HTTP.
  const ctx = (process.env.CONTEXT || '').toLowerCase();
  if (ctx && ctx !== 'production') {
    console.log('[cron] skip — CONTEXT=', ctx);
    return { statusCode: 200, body: 'skip (non-production)' };
  }

  try {
    await tick();
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('[cron error]', e && (e.stack || e.message || e));
    return { statusCode: 200, body: 'error' };
  }
};
