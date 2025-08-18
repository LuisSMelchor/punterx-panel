// netlify/functions/tg_trial_webhook.cjs
const { supabase } = require('./_supabase-client.cjs');
const { tgSendMessage, tgCreateInviteLink } = require('./send.js');

const VERSION = 'tg_trial_webhook v2.0 (trial-on)';
function addDays(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; }

exports.handler = async (event) => {
  try {
    console.log(`[${VERSION}] method=${event && event.httpMethod}`);
    if (!event || event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
      const preview = (event.body || '').slice(0, 160).replace(/\s+/g, ' ');
      console.log(`[${VERSION}] body[0..160]= ${preview}`);
    } catch { return { statusCode: 200, body: 'bad json' }; }

    if (!update || !Object.prototype.hasOwnProperty.call(update, 'message')) return { statusCode: 200, body: 'ignored' };
    const msg = update.message;
    if (!msg || typeof msg !== 'object') return { statusCode: 200, body: 'ignored' };
    const chat = msg.chat;
    if (!chat || chat.type !== 'private') return { statusCode: 200, body: 'ignored' };
    if (!Object.prototype.hasOwnProperty.call(msg, 'text') || typeof msg.text !== 'string' || msg.text.trim() === '') return { statusCode: 200, body: 'ignored' };

    const chatId = chat.id; // ✅ no usamos msg.from
    const text = msg.text.trim();
    const trialDays = Number(process.env.TRIAL_DAYS) || 15;

    const isStart = text.indexOf('/start') === 0;
    const isVip   = text.indexOf('/vip') === 0;
    if (!isStart && !isVip) {
      await tgSendMessage(chatId, '👋 Bienvenido a PunterX.\nEscribe /vip para activar tu prueba gratis de 15 días en el grupo VIP.');
      return { statusCode: 200, body: 'ok' };
    }

    // 1) Consulta estado
    const { data: existing, error: qErr } = await supabase
      .from('usuarios').select('id_telegram, estado, fecha_expira')
      .eq('id_telegram', chatId).maybeSingle();

    if (qErr) { console.error(`[${VERSION}] Supabase select error`, qErr); await tgSendMessage(chatId, '⚠️ Error temporal. Intenta de nuevo.'); return { statusCode: 200, body: 'error' }; }

    if (existing && existing.estado === 'premium') { await tgSendMessage(chatId, '✅ Ya eres <b>Premium</b>. Revisa el grupo VIP.'); return { statusCode: 200, body: 'ok' }; }

    if (existing && existing.estado === 'trial' && existing.fecha_expira && new Date(existing.fecha_expira) > new Date()) {
      const diasRest = Math.ceil((new Date(existing.fecha_expira) - new Date()) / (1000*60*60*24));
      await tgSendMessage(chatId, `ℹ️ Tu prueba sigue activa. Te quedan <b>${diasRest} día(s)</b>.`);
      return { statusCode: 200, body: 'ok' };
    }

    if (existing && existing.estado === 'expired') { await tgSendMessage(chatId, '⛔ Tu periodo de prueba ya expiró.\nPara continuar, contrata el plan Premium.'); return { statusCode: 200, body: 'ok' }; }

    // 2) Activar trial
    const fecha_inicio = new Date();
    const fecha_expira = addDays(fecha_inicio, trialDays);

    const upsert = await supabase
      .from('usuarios')
      .upsert({ id_telegram: chatId, username: '', estado: 'trial', fecha_inicio: fecha_inicio.toISOString(), fecha_expira: fecha_expira.toISOString() }, { onConflict: 'id_telegram' })
      .select().maybeSingle();

    if (upsert.error) { console.error(`[${VERSION}] Supabase upsert error`, upsert.error); await tgSendMessage(chatId, '⚠️ Error al activar tu prueba. Intenta de nuevo.'); return { statusCode: 200, body: 'error' }; }

    // 3) Invite link (bot admin + permiso para invitar)
    const inviteLink = await tgCreateInviteLink();
    if (!inviteLink) { await tgSendMessage(chatId, '⚠️ No pude generar el enlace de invitación. Intenta más tarde.'); return { statusCode: 200, body: 'error' }; }

    await tgSendMessage(chatId, ['🎁 <b>Prueba VIP activada</b> (15 días).','Haz clic para unirte al grupo VIP:', inviteLink,'','🔔 Al finalizar tu prueba, podrás elegir continuar como <b>Premium</b>.'].join('\n'));
    console.log(`[${VERSION}] trial granted and link sent`);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] webhook error`, e);
    return { statusCode: 200, body: 'error' };
  }
};
