// netlify/functions/telegram-webhook.cjs
const { supabase } = require('./_supabase-client.cjs');
const { tgSendMessage, tgCreateInviteLink } = require('./send.js');

const VERSION = 'telegram-webhook v4.0';

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

exports.handler = async (event) => {
  try {
    // Marca de versión para confirmar que corre el build correcto
    console.log(`[${VERSION}] method=${event.httpMethod}`);

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Parse JSON seguro
    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
    } catch {
      console.log(`[${VERSION}] bad json`);
      return { statusCode: 200, body: 'bad json' };
    }

    // SOLO aceptamos message o edited_message de chat PRIVADO con texto y from
    const msg = update?.message || update?.edited_message || null;
    if (!msg) {
      console.log(`[${VERSION}] ignored: no message`);
      return { statusCode: 200, body: 'ignored: no message' };
    }

    const chat = msg?.chat || {};
    if (chat?.type !== 'private') {
      console.log(`[${VERSION}] ignored: not private chat`);
      return { statusCode: 200, body: 'ignored: not private chat' };
    }

    // IMPORTANTE: NO tocar .from si no existe
    if (!msg?.from || typeof msg?.text !== 'string' || !msg.text.trim()) {
      console.log(`[${VERSION}] ignored: missing from/text`);
      return { statusCode: 200, body: 'ignored: missing from/text' };
    }

    const text = msg.text.trim();
    const tgId = msg.from.id;
    const username = msg.from.username || '';
    const trialDays = Number(process.env.TRIAL_DAYS) || 15;

    // Comandos válidos
    const isStart = text.startsWith('/start');  // soporta /start vip15
    const isVip   = text.startsWith('/vip');
    if (!isStart && !isVip) {
      await tgSendMessage(
        tgId,
        '👋 Bienvenido a PunterX.\nEscribe /vip para activar tu prueba gratis de 15 días en el grupo VIP.'
      );
      console.log(`[${VERSION}] hint sent`);
      return { statusCode: 200, body: 'ok' };
    }

    // 1) Consultar estado en Supabase
    const { data: existing, error: qErr } = await supabase
      .from('usuarios')
      .select('id_telegram, estado, fecha_expira')
      .eq('id_telegram', tgId)
      .maybeSingle();

    if (qErr) {
      console.error(`[${VERSION}] Supabase select error`, qErr);
      await tgSendMessage(tgId, '⚠️ Error temporal. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'error' };
    }

    // 2) Reglas por estado
    if (existing?.estado === 'premium') {
      await tgSendMessage(tgId, '✅ Ya eres <b>Premium</b>. Revisa el grupo VIP en tu Telegram.');
      console.log(`[${VERSION}] user premium`);
      return { statusCode: 200, body: 'ok' };
    }

    if (existing?.estado === 'trial' && existing?.fecha_expira && new Date(existing.fecha_expira) > new Date()) {
      const diasRest = Math.ceil((new Date(existing.fecha_expira) - new Date()) / (1000 * 60 * 60 * 24));
      await tgSendMessage(tgId, `ℹ️ Tu prueba sigue activa. Te quedan <b>${diasRest} día(s)</b>.`);
      console.log(`[${VERSION}] user trial active`);
      return { statusCode: 200, body: 'ok' };
    }

    if (existing?.estado === 'expired') {
      await tgSendMessage(tgId, '⛔ Tu periodo de prueba ya expiró.\nPara continuar, contrata el plan Premium.');
      console.log(`[${VERSION}] user trial expired`);
      return { statusCode: 200, body: 'ok' };
    }

    // 3) Activar trial 15 días + link de 1 uso
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
      console.error(`[${VERSION}] Supabase upsert error`, upsert.error);
      await tgSendMessage(tgId, '⚠️ Error al activar tu prueba. Intenta de nuevo.');
      return { statusCode: 200, body: 'error' };
    }

    const inviteLink = await tgCreateInviteLink();
    if (!inviteLink) {
      console.log(`[${VERSION}] invite link fail`);
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
    console.log(`[${VERSION}] trial granted and link sent`);

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] webhook error`, e);
    return { statusCode: 200, body: 'error' };
  }
};
