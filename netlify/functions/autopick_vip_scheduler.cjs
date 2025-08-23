const https = require('node:https');
const { URL } = require('node:url');

function httpsGet(u, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const p = new URL(u);
    const req = https.request(
      { method: 'GET', hostname: p.hostname, path: p.pathname + (p.search || ''), headers, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { try { req.destroy(new Error('timeout')); } catch {} reject(new Error('timeout')); });
    req.end();
  });
}

exports.handler = async function () {
  try {
    const base =
      (process && process.env && process.env.URL) ||
      (process && process.env && process.env.DEPLOY_PRIME_URL) ||
      'https://punterx-panel-vip.netlify.app';

    const url = base + '/.netlify/functions/autopick-vip-run2?from=scheduler';

    // 1) Intento con fetch si existe
    let resObj = null;
    try {
      if (typeof fetch === 'function') {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 8000);
        const res = await fetch(url, { headers: { 'x-nf-scheduled': '1' }, signal: ac.signal });
        clearTimeout(t);
        const text = await res.text();
        resObj = { status: res.status, text };
      }
    } catch (_) { /* fallback abajo */ }

    // 2) Fallback a https nativo
    if (!resObj) resObj = await httpsGet(url, { 'x-nf-scheduled': '1' });

    let payload = null;
    try { payload = JSON.parse(resObj.text); } catch (_) {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        triggered: 'run2',
        status: resObj.status,
        resumen: (payload && payload.resumen) ? payload.resumen : null,
        raw: payload ? undefined : resObj.text
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: (e && e.message) ? e.message : String(e) }),
    };
  }
};
