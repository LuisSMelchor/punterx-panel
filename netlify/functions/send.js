// netlify/functions/send.js
// Envío a Telegram + opcional log en Supabase (usa shim).
// POST /.netlify/functions/send
// Body JSON: { scope: "canal"|"vip", text: "mensaje" }

const getSupabase = require('./_supabase-client.cjs');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID
} = process.env;

const T_NET = 8000;

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(resource, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function pickChatId(scope) {
  // "canal" → channel id; "vip" → group id
  if (scope === 'vip') return TELEGRAM_GROUP_ID;
  return TELEGRAM_CHANNEL_ID;
}

async function tgSend(scope, text) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN ausente');
  const chat_id = pickChatId(scope);
  if (!chat_id) throw new Error(`Chat ID ausente para scope="${scope}"`);

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok !== true) {
    throw new Error(`Telegram error: ${res.status} ${data ? JSON.stringify(data).slice(0,180) : ''}`);
  }
  return data;
}

async function logSupabase(entry) {
  try {
    const supabase = await getSupabase();
    // Si no tienes esta tabla, puedes comentar este bloque sin problema.
    await supabase
      .from('logs_envios')
      .insert([{
        scope: entry.scope,
        text: entry.text?.slice(0, 2000) || '',
        sent_at: new Date().toISOString(),
        tg_message_id: entry.tg_message_id || null
      }]);
  } catch (e) {
    // logging es best-effort: no bloquear si falla
    console.warn('[SEND] No se pudo loguear en Supabase:', e?.message || e);
  }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error:'Use POST' }) };
    }

    const payload = JSON.parse(event.body || '{}');
    const scope = payload.scope || 'canal';
    const text = payload.text || '';

    if (!text.trim()) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error:'Texto vacío' }) };
    }

    const tg = await tgSend(scope, text);
    await logSupabase({ scope, text, tg_message_id: tg?.result?.message_id });

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:true, telegram: tg }) };
  } catch (e) {
    const msg = e?.message || String(e);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: msg }) };
  }
};
