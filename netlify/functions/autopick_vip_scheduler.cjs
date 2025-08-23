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

function logChunk(label, str, max) {
  if (!str) return console.log(label, '(sin cuerpo)');
  const chunk = str.slice(0, max);
  console.log(label, 'len=', str.length, '\n---8<---\n' + chunk + '\n---8<---');
}

exports.handler = async function (event) {
  
  // fast-path de salud: ?ping=1
  const __qs = (event && event.queryStringParameters) || {};
  if (__qs.ping === '1') {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, ping: "scheduler alive (prod)", node: (typeof process!=='undefined'?process.version:undefined) })
    };
  }
try {
    const qs = (event && event.queryStringParameters) || {};
    const wantFull = qs.full === '1';
    const passDebug = qs.debug === '1';
    const MAX = wantFull ? 10000 : 3000;

    const base =
      (typeof process !== 'undefined' && process.env && process.env.URL) ||
      (typeof process !== 'undefined' && process.env && process.env.DEPLOY_PRIME_URL) ||
      'https://punterx-panel-vip.netlify.app';

    const run2Url = new URL(base + '/.netlify/functions/autopick-vip-run2');
    run2Url.searchParams.set('from', 'scheduler');
    // si quieres que SOLO en manual pase debug, usa: if (passDebug) if (passDebug) run2Url.searchParams.set("debug","1")
    if (passDebug) run2Url.searchParams.set("debug","1");

    const headers = { 'x-nf-scheduled': '1' };
    let status, body;

    if (globalThis.fetch) {
      const r = await fetch(run2Url, { headers });
      status = r.status;
      body = await r.text();
    } else {
      const r = await httpsGet(run2Url.toString(), headers);
      status = r.status;
      body = r.text || '';
    }

    console.log('[scheduler] run2 status', { status });
    logChunk('[scheduler] run2 body (trunc)', body, MAX);

    let json = null;
    try { json = JSON.parse(body); } catch {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        triggered: 'run2',
        status,
        resumen: json && json.resumen ? json.resumen : null,
        raw_snippet: body ? body.slice(0, MAX) : null,
        trunc: body ? Math.max(0, body.length - MAX) : 0
      })
    };
  } catch (e) {
    console.error('[scheduler] error', e && e.stack || e);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: (e && e.message) || String(e) })
    };
  }
};
