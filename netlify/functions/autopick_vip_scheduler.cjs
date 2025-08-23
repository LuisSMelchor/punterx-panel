'use strict';
const https = require('https');
const { URL } = require('url');

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

exports.handler = async function (event) {
  try {
    const qs = (event && event.queryStringParameters) || {};
    // ping rápido
    if (qs.ping === '1') {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, ping: "autopick_vip_scheduler (pong)" })
      };
    }

    const base = (process.env && (process.env.URL || process.env.DEPLOY_PRIME_URL)) || "https://punterx-panel-vip.netlify.app";
    const u = new URL(`${base}/.netlify/functions/autopick-vip-run2`);
    if (qs.manual === '1') u.searchParams.set('manual', '1');
    if (qs.debug  === '1') u.searchParams.set('debug',  '1');

    const r = await httpsGet(u.toString(), { 'x-nf-scheduled': '1' });
    const raw = r.text || '';
    let json = null;
    try { json = JSON.parse(raw); } catch {}

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        triggered: "run2",
        status: r.status,
        resumen: json && json.resumen ? json.resumen : null,
        raw_snippet: json ? undefined : raw.slice(0, 2000)
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: (e && e.message) || String(e) })
    };
  }
};
