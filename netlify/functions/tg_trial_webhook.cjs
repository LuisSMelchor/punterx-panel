// netlify/functions/tg_trial_webhook.cjs
// v3.1 — self-contained + robust Supabase init + chat.id only

// 🔒 Supabase: intenta usar tu cliente local; si no, crea uno con ENV
let supabase;
try {
  const mod = require('./_supabase-client.cjs');
  supabase = mod.supabase || mod.client || mod.default || mod;
} catch (e) {
  // módulo no encontrado o sin export esperado
}
if (!supabase) {
  const { createClient } = require('@supabase/supabase-js');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY; // por si usas otra var
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Supabase init] Faltan SUPABASE_URL / KEY en ENV');
  } else {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
}

const VERSION = 'tg_trial_webhook v3.1 (self-contained)';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VIP_GROUP_ID = process.env.TELEGRAM_VIP_GROUP_ID;
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 15;

function addDays(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; }

async function tgSendMessageLocal(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.ok) console.error('[tgSendMessageLocal] fail', json);
  return !!json.ok;
}

async function tgCreateInviteLinkLocal() {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`;
  const body = { chat_id: VIP_GROUP_ID, member_limit: 1, creates_join_request: false };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!json.ok) { console.error('[tgCreateInviteLinkLocal] fail', json); return null; }
  return json.result && json.result.invite_link ? json.result.invite_link : null;
}

console.log('[env check] SUPABASE_URL?', !!process.env.SUPABASE_URL);
console.log('[env check] SUPABASE_KEY?', !!process.env.SUPABASE_KEY || !!process.env.SUPABASE_SERVICE_ROLE_KEY || !!process.env.SUPABASE_ANON_KEY);
console.log('[env check] TELEGRAM_BOT_TOKEN?', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('[env check] TELEGRAM_VIP_GROUP_ID?', !!process.env.TELEGRAM_VIP_GROUP_ID);

exports.handler = async (event) => {
  try {
    console.log(`[${VERSION}] method=${event && event.httpMethod}`);
    if (!event || event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Parseo seguro + preview
    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
      const preview = (event.body || '').slice(0, 160).replace(/\s+/g, ' ');
      console.log(`[${VERSION}] body[0..160]= ${preview}`);
    } catch {
      return { statusCode: 200, body: 'bad json' };
    }

    // ✅ SOLO aceptamos update.message de chat PRIVADO con texto
    if (!update || !Object.prototype.hasOwnProperty.call(update, 'message')) return { statusCode: 200, body: 'ignored' };
    const msg = update.message;
    if (!msg || typeof msg !== 'object') return { statusCode: 200, body: 'ignored' };
    const chat = msg.chat;
    if (!chat || chat.type !== 'private') return { statusCode: 200, body: 'ignored' };
    if (!Object.prototype.hasOwnProperty.call(msg, 'text') || typeof msg.text !== 'string' || msg.text.trim() === '') return { statusCode: 200, body: 'ignored' };

    // ⚡️ En privados usamos SIEMPRE chat.id (no tocamos msg.from)
    const chatId = chat.id;
    const text = msg.text.trim();

    // Comandos válidos
    const isStart = text.indexOf('/start') === 0;  // p.ej. "/start vip15"
    const isVip   = text.indexOf('/vip') === 0;
    if (!isStart && !isVip) {
      await tgSendMessageLocal(chatId, '👋 Bienvenido a PunterX.\nEscribe /vip para activar tu prueba gratis de 15 días en el grupo VIP.');
      return { statusCode: 200, body: 'ok' };
    }

    // 🧪 Chequeo duro: ¿tenemos supabase?
    if (!supabase || typeof supabase.from !== 'function') {
      console.error('[Supabase] Cliente no inicializado. Revisa _supabase-client.cjs o ENV SUPABASE_URL/KEY.');
      await tgSendMessageLocal(chatId, '⚠️ Configuración pendiente del servidor. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'no-supabase' };
    }

    // 1) Consulta estado del usuario
    const { data: existing, error: qErr } = await supabase
      .from('usuarios')
      .select('id_telegram, estado, fecha_expira')
      .eq('id_telegram', chatId)
      .maybeSingle();

    if (qErr) {
      console.error('[Supabase select error]', qErr);
      await tgSendMessageLocal(chatId, '⚠️ Error temporal. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'error' };
    }

    if (existing && existing.estado === 'premium') {
      await tgSendMessageLocal(chatId, '✅ Ya eres <b>Premium</b>. Revisa el grupo VIP en tu Telegram.');
      return { statusCode: 200, body: 'ok' };
    }

    if (existing && existing.estado === 'trial' && existing.fecha_expira && new Date(existing.fecha_expira) > new Date()) {
      const diasRest = Math.ceil((new Date(existing.fecha_expira) - new Date()) / (1000 * 60 * 60 * 24));
      await tgSendMessageLocal(chatId, `ℹ️ Tu prueba sigue activa. Te quedan <b>${diasRest} día(s)</b>.`);
      return { statusCode: 200, body: 'ok' };
    }

    if (existing && existing.estado === 'expired') {
      await tgSendMessageLocal(chatId, '⛔ Tu periodo de prueba ya expiró.\nPara continuar, contrata el plan Premium.');
      return { statusCode: 200, body: 'ok' };
    }

    // 2) Activar trial y guardar
    const fecha_inicio = new Date();
    const fecha_expira = addDays(fecha_inicio, TRIAL_DAYS);

    const upsert = await supabase
      .from('usuarios')
      .upsert(
        {
          id_telegram: chatId,
          username: '', // si luego quieres guardar username, lo añadimos con guardias
          estado: 'trial',
          fecha_inicio: fecha_inicio.toISOString(),
          fecha_expira: fecha_expira.toISOString(),
        },
        { onConflict: 'id_telegram' }
      )
      .select()
      .maybeSingle();

    if (upsert.error) {
      console.error('[Supabase upsert error]', upsert.error);
      await tgSendMessageLocal(chatId, '⚠️ Error al activar tu prueba. Intenta de nuevo.');
      return { statusCode: 200, body: 'error' };
    }

    // 3) Crear link de invitación (1 uso)
    const inviteLink = await tgCreateInviteLinkLocal();
    if (!inviteLink) {
      await tgSendMessageLocal(chatId, '⚠️ No pude generar el enlace de invitación. Intenta más tarde.');
      return { statusCode: 200, body: 'error' };
    }

    await tgSendMessageLocal(
      chatId,
      [
        '🎁 <b>Prueba VIP activada</b> (15 días).',
        'Haz clic para unirte al grupo VIP:',
        inviteLink,
        '',
        '🔔 Al finalizar tu prueba, podrás elegir continuar como <b>Premium</b>.',
      ].join('\n')
    );

    console.log(`[${VERSION}] trial granted and link sent`);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] webhook error`, e);
    return { statusCode: 200, body: 'error' };
  }
};
