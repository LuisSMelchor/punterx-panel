// netlify/functions/send.js
// Envío a Telegram con defensas: no reventar el init del módulo si falla fetch/HTTP.

// Shim de fetch si el entorno no lo expone aún
if (typeof fetch === 'undefined') {
  try { global.fetch = require('node-fetch'); } catch (_) {}
}

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID
} = process.env;

const T_NET = 8000;
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally { clearTimeout(id); }
}

async function sendTelegram(text, target = 'channel') {
  const token = TELEGRAM_BOT_TOKEN;
  const chat_id = target === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!token || !chat_id) return { ok: false, error: 'Faltan TELEGRAM_BOT_TOKEN/CHAT_ID' };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: String(text || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const ok = res.ok;
    const body = await res.text().catch(()=> '');
    return { ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'POST') {
      const payload = event.body ? JSON.parse(event.body) : {};
      const { text, target } = payload || {};
      const r = await sendTelegram(text, target === 'vip' ? 'vip' : 'channel');
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) };
    }

    // GET: mini-doc & ping
    if ((event.queryStringParameters || {}).ping) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'pong' };
    }

    const html = `<!doctype html><meta charset="utf-8">
<title>PunterX — send</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  code{background:#0f1220;padding:2px 6px;border-radius:6px}
</style>
<div class="card">
  <h1>send</h1>
  <p>POST JSON → <code>{ "text": "hola", "target": "vip|channel" }</code></p>
  <p>GET ping → <code>?ping=1</code></p>
</div>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  } catch (e) {
    // No devolvemos 500 para evitar “Internal Error”
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};
