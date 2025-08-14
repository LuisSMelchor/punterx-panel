// netlify/functions/send.js
// Envío a Telegram (FREE/VIP) — robusto y con polyfill de fetch

try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID, // FREE
  TELEGRAM_GROUP_ID    // VIP
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

async function sendTelegram(text, tipo = 'free') {
  if (!TELEGRAM_BOT_TOKEN) return { ok:false, error:'TELEGRAM_BOT_TOKEN ausente' };
  const chat_id = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!chat_id) return { ok:false, error:`chat_id ausente para tipo=${tipo}` };

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetchWithTimeout(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        chat_id,
        text: String(text || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) {
      return { ok:false, status:res.status, error: data ? JSON.stringify(data).slice(0,200) : 'HTTP error' };
    }
    return { ok:true, data };
  } catch (e) {
    return { ok:false, error: e?.message || String(e) };
  }
}

function ok(body){ return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }; }
function html(){ return `<!doctype html><meta charset="utf-8">
<title>PunterX — Send</title>
<style>body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}.card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}</style>
<div class="card">
  <h1>send</h1>
  <p>POST JSON → {"text":"hola","tipo":"vip|free"}</p>
  <p>GET ping → ?ping=1</p>
</div>`; }

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    if (event.httpMethod === 'GET') {
      if (qs.ping) return { statusCode:200, headers:{'Content-Type':'text/plain; charset=utf-8'}, body:'pong' };
      return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body: html() };
    }
    if (event.httpMethod !== 'POST') return ok({ ok:false, error:'Use POST' });

    const ctype = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let text='', tipo='free';
    if (ctype.includes('application/json')) {
      const body = JSON.parse(event.body || '{}');
      text = String(body.text || ''); tipo = String(body.tipo || 'free');
    } else if (ctype.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body || '');
      text = String(params.get('text') || ''); tipo = String(params.get('tipo') || 'free');
    } else {
      try {
        const body = JSON.parse(event.body || '{}');
        text = String(body.text || ''); tipo = String(body.tipo || 'free');
      } catch { return ok({ ok:false, error:'Body no reconocido; usa JSON o form-urlencoded' }); }
    }
    if (!text) return ok({ ok:false, error:'Falta "text"' });

    const r = await sendTelegram(text, (tipo === 'vip' ? 'vip' : 'free'));
    return ok(r);
  } catch (e) {
    return ok({ ok:false, error: e?.message || String(e) });
  }
};
