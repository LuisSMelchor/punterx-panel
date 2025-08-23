// Scheduler robusto: siempre JSON, con trazas, y sin dependencias externas.
// Intenta fetch si existe; si no, usa https nativo.
const https = require('node:https');
const { URL } = require('node:url');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, text: () => Promise.resolve(data) }));
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  try {
    const base =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      "https://punterx-panel-vip.netlify.app";

    // modo ping para comprobar que el handler SI arranca en el runtime
    if (event && event.queryStringParameters && event.queryStringParameters.ping === '1') {
      console.log("[scheduler] ping ok", { node: process.version, base });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, ping: true })
      };
    }

    const url = `${base}/.netlify/functions/autopick-vip-run2?from=scheduler`;
    console.log("[scheduler] start", { node: process.version, base });

    let res;
    const f = globalThis && globalThis.fetch;
    if (typeof f === 'function') {
      res = await f(url, { headers: { "x-nf-scheduled": "1" } });
      // normaliza a interfaz { status, text() }
      res = { status: res.status, text: () => res.text() };
    } else {
      console.log("[scheduler] usando https fallback");
      res = await httpsGet(url, { "x-nf-scheduled": "1" });
    }

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    console.log("[scheduler] done", { status: res.status, hasJSON: !!json });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        triggered: "run2",
        status: res.status,
        resumen: json?.resumen ?? null,
        raw: json ? undefined : text
      })
    };
  } catch (e) {
    console.error("[scheduler] error", e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) })
    };
  }
};
