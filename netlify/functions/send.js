// netlify/functions/send.js
// Envío a Telegram (FREE / VIP) con polyfill de fetch y manejo robusto

// 1) Polyfill fetch si el runtime lo necesita
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

function ok(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function bad(msg) { return ok({ ok: false, error: msg }); }

async function sendTelegram(text, tipo = 'free') {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' };
  const chat_id = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!chat_id) return { ok: false, error: `chat_id ausente para tipo=${tipo}` };

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }).catch(e => ({ ok:false, _err:e?.message || String(e), status:0 }));

  if (!res || !res.ok) {
    const body = res && res.text ? await res.text().catch(()=> '') : '';
    return { ok: false, status: res?.status || 0, error: String(body).slice(0, 250) };
  }
  const data = await res.json().catch(()=> ({}));
  return { ok: true, data };
}

function renderHTML() {
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Send</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  input,textarea,select,button{font:inherit}
  textarea{width:100%;height:140px}
</style>
<div class="card">
  <h1>Enviar mensaje de prueba a Telegram</h1>
  <form method="POST">
    <p>
      <label>Tipo:
        <select name="tipo">
          <option value="free">Canal FREE</option>
          <option value="vip">Grupo VIP</option>
        </select>
      </label>
    </p>
    <p><textarea name="text">Hola desde send.js</textarea></p>
    <p><button type="submit">Enviar</button></p>
  </form>
  <p class="muted">También puedes llamar vía JSON: <code>POST</code> con <code>{"text":"...", "tipo":"vip|free"}</code></p>
</div>`;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      if ((event.queryStringParameters || {}).json) {
        return ok({
          ok: true,
          env_presence: {
            TELEGRAM_BOT_TOKEN: !!TELEGRAM_BOT_TOKEN,
            TELEGRAM_CHANNEL_ID: !!TELEGRAM_CHANNEL_ID,
            TELEGRAM_GROUP_ID: !!TELEGRAM_GROUP_ID,
          }
        });
      }
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML() };
    }

    if (event.httpMethod === 'POST') {
      let text = '';
      let tipo = 'free';

      const ctype = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
      if (ctype.includes('application/json')) {
        try {
          const body = JSON.parse(event.body || '{}');
          text = String(body.text || '');
          tipo = String(body.tipo || 'free');
        } catch (e) {
          return bad('JSON inválido');
        }
      } else if (ctype.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(event.body || '');
        text = String(params.get('text') || '');
        tipo = String(params.get('tipo') || 'free');
      } else {
        // intento best-effort
        try {
          const body = JSON.parse(event.body || '{}');
          text = String(body.text || '');
          tipo = String(body.tipo || 'free');
        } catch {
          return bad('Body no reconocido; usa JSON o form-urlencoded');
        }
      }

      if (!text) return bad('Falta "text"');
      if (tipo !== 'vip' && tipo !== 'free') tipo = 'free';

      const r = await sendTelegram(text, tipo);
      return ok(r);
    }

    return bad(`Método no soportado: ${event.httpMethod}`);
  } catch (e) {
    return bad(e?.message || String(e));
  }
};
