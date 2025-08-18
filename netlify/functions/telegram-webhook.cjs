// netlify/functions/telegram-webhook.cjs
const { supabase } = require('./_supabase-client.cjs');
const { tgSendMessage, tgCreateInviteLink } = require('./send.js');

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// --- Extractores SEGUROS (no asumen que exista .from) ---
function pickPrivateTextAndUser(update) {
  // 1) Mensaje normal
  if (update && update.message && update.message.chat && update.message.chat.type === 'private') {
    const m = update.message;
    if (typeof m.text === 'string' && m.from && m.from.id) {
      return { text: m.text.trim(), userId: m.from.id, username: m.from.username || '' };
    }
  }
  // 2) Mensaje editado
  if (update && update.edited_message && update.edited_message.chat && update.edited_message.chat.type === 'private') {
    const m = update.edited_message;
    if (typeof m.text === 'string' && m.from && m.from.id) {
      return { text: m.text.trim(), userId: m.from.id, username: m.from.username || '' };
    }
  }
  // 3) Callback button (solo si proviene de chat privado)
  if (
    update && update.callback_query &&
    update.callback_query.message &&
    update.callback_query.message.chat &&
    update.callback_query.message.chat.type === 'private' &&
    typeof update.callback_query.data === 'string' &&
    update.callback_query.from && update.callback_query.from.id
  ) {
    return {
      text: update.callback_query.data.trim(),
      userId: update.callback_query.from.id,
      username: update.callback_query.from.username || ''
    };
  }
  // 4) Inline query u otros → no procesamos trial aquí (se responde instruyendo a escribir /vip por DM)
  return null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Parse JSON seguro
    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 200, body: 'bad json' };
    }

    // Toma SOLO texto + usuario de chat privado (o callback en privado)
    const ctx = pickPrivateTextAndUser(update);
    if (!ctx) {
      // Ignora todo lo que no sea mensaje privado usable (evita tocar .from)
      return { statusCode: 200, body: 'ignored' };
    }

    const { text, userId: tgId, username } = ctx;
    const trialDays = Number(process.env.TRIAL_DAYS) || 15;

    // Comandos válidos
    const isStart = text.startsWith('/start'); // /start vip15
    const isVip = text.startsWith('/vip');
    if (!isStart && !isVip) {
      await tgSendMessage(
        tgId,
        '👋 Bienvenido a PunterX.\nEscribe /vip para activar tu prueba gratis de 15 días en el grupo VIP.'
      );
      return { statusCode: 200, body: 'ok' };
    }

    // 1) Consulta estado en Supabase
    const { data: existing, error: qErr } = await supabase
      .from('usuarios')
      .select('id_telegram, estado, fecha_expira')
      .eq('id_telegram', tgId)
      .maybeSingle();

    if (qErr) {
      console.error('Supabase select error', qErr);
      await tgSendMessage(tgId, '⚠️ Error temporal. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'error' };
    }

    // 2) Reglas por estado
    if (existing?.estado === 'premium') {
      await tgSendMessage(tgId, '✅ Ya eres <b>Premium</b>. Revisa el grupo VIP en tu Telegram.');
      return { statusCode: 200, body: 'ok' };
    }

    if (existing?.estado === 'trial' && existing?.fecha_expira && new Date(existing.fecha_expira) > new Date()) {
      const diasRest = Math.ceil((new Date(existing.fecha_expira) - new Date()) / (1000 * 60 * 60 * 24));
      await tgSendMessage(tgId, `ℹ️ Tu prueba sigue activa. Te quedan <b>${diasRest} día(s)</b>.`);
      return { statusCode: 200, body: 'ok' };
    }

    if (existing?.estado === 'expired') {
      await tgSendMessage(tgId, '⛔ Tu periodo de prueba ya expiró.\nPara continuar, contrata el plan Premium.');
      return { statusCode: 200, body: 'ok' };
    }

    // 3) Activar trial 15 días + link de invitación de 1 uso
    const fecha_inicio = new Date();
    const fecha_expira = addDays(fecha_inicio, trialDays);

    const upsert = await supabase
      .from('usuarios')
      .upsert(
        {
          id_telegram: tgId,
          username,
          estado: 'trial',
          fecha_inicio: fecha_inicio.toISOString(),
          fecha_expira: fecha_expira.toISOString(),
        },
        { onConflict: 'id_telegram' }
      )
      .select()
      .maybeSingle();

    if (upsert.error) {
      console.error('Supabase upsert error', upsert.error);
      await tgSendMessage(tgId, '⚠️ Error al activar tu prueba. Intenta de nuevo.');
      return { statusCode: 200, body: 'error' };
    }

    const inviteLink = await tgCreateInviteLink();
    if (!inviteLink) {
      await tgSendMessage(tgId, '⚠️ No pude generar el enlace de invitación. Intenta más tarde.');
      return { statusCode: 200, body: 'error' };
    }

    await tgSendMessage(
      tgId,
      [
        '🎁 <b>Prueba VIP activada</b> (15 días).',
        'Haz clic para unirte al grupo VIP:',
        inviteLink,
        '',
        '🔔 Al finalizar tu prueba, podrás elegir continuar como <b>Premium</b>.',
      ].join('\n')
    );

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error('webhook error', e);
    return { statusCode: 200, body: 'error' };
  }
};
