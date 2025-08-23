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

function logChunk(label, str, max = 2000) {
  if (!str) return console.log(label, '(sin cuerpo)');
  const chunk = str.slice(0, max);
  console.log(label, 'len=', str.length, '\n---8<---\n' + chunk + '\n---8<---');
}

exports.handler = async function () {
  try {
    const base =
      (typeof process !== 'undefined' && process.env && process.env.URL) ||
      (typeof process !== 'undefined' && process.env && process.env.DEPLOY_PRIME_URL) ||
      'https://punterx-panel-vip.netlify.app';

    // Forzamos debug=1 para que run2 imprima trazas
    const url = `${base}/.netlify/functions/autopick-vip-run2?from=scheduler&debug=1`;

    console.log('[scheduler] calling run2', { url });

    // fetch si existe, si no https fallback
    let res, text;
    if (globalThis.fetch) {
      const r = await fetch(url, { headers: { 'x-nf-scheduled': '1' } });
      res = { status: r.status, text: await r.text() };
    } else {
      res = await httpsGet(url, { 'x-nf-scheduled': '1' });
    }
    text = res.text || '';

    console.log('[scheduler] run2 status', { status: res.status });
    logChunk('[scheduler] run2 body (trunc)', text);

    // Intentamos parsear, pero no fallamos si viene texto
    let json = null;
    try { json = JSON.parse(text); } catch {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        triggered: 'run2',
        status: res.status,
        resumen: json && json.resumen ? json.resumen : null,
        raw_snippet: text ? text.slice(0, 2000) : null
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
