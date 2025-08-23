// CJS, robusto, siempre devuelve JSON y tolera falta de fetch (usa https fallback).
const https = require('node:https');
const { URL } = require('node:url');

function httpsGet(u, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(u);
    const req = https.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        path: parsed.pathname + (parsed.search || ''),
        headers: headers || {},
        timeout: timeoutMs || 8000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      try { req.destroy(new Error('timeout')); } catch {}
      reject(new Error('timeout'));
    });
    req.end();
  });
}

async function safeFetch(u, headers) {
  // Usa fetch nativo si existe y cae a https si no
  try {
    if (typeof fetch === 'function') {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const res = await fetch(u, { headers: headers || {}, signal: ac.signal });
      clearTimeout(t);
      const text = await res.text();
      return { status: res.status, text };
    }
  } catch (e) {
    // cae al https fallback
  }
  return httpsGet(u, headers, 8000);
}

exports.handler = async function () {
  try {
    const base =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      'https://punterx-panel-vip.netlify.app';

    const url = base + '/.netlify/functions/autopick-vip-run2?from=scheduler';

    const res = await safeFetch(url, { 'x-nf-scheduled': '1' });
    let payload = null;
    try { payload = JSON.parse(res.text); } catch (_) {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        triggered: 'run2',
        status: res.status,
        resumen: payload && payload.resumen ? payload.resumen : null,
        raw: payload ? undefined : res.text
      }),
    };
  } catch (e) {
    return {
      statusCode: 200, // 200 para que siempre sea parseable con jq
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: (e && e.message) ? e.message : String(e) }),
    };
  }
};
