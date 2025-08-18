// netlify/functions/telegram-webhook.cjs
const { supabase } = require('./_supabase-client.cjs');
const { tgSendMessage, tgCreateInviteLink } = require('./send.js');

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const update = JSON.parse(event.body || '{}');

    // Asegurarnos de que sea texto de usuario (chat personal)
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text || !msg.from) {
      return { statusCode: 200, body: 'No valid user message' };
    }

    const text = String(msg.text).trim();
    const from = msg.from;
    const tgId = from.id;
    const username = from.username || '';
    
    // Comandos válidos
    const isStart = text.startsWith('/start');
    const isVip = text.startsWith('/vip');
    if (!isStart && !isVip) {
      await tgSendMessage(tgId, 'Para comenzar, escribe /vip para activar tu prueba gratis de 15 días.');
      return { statusCode: 200, body: 'ok' };
    }

    // (Aquí va el resto del flujo: consulta/upsert en Supabase, creación de link de invitación, etc.)
    if (existing?.estado === 'expired') {
      // Política: sin re-trial. Si quieres permitir reintentos, cambia esta rama.
      await tgSendMessage(tgId, '⛔ Tu periodo de prueba ya expiró. Para continuar, contrata el plan Premium.');
      return { statusCode: 200, body: 'ok' };
    }

    // 3) Otorgar trial 15 días y devolver link de invitación de 1 uso
    const fecha_inicio = new Date();
    const fecha_expira = addDays(fecha_inicio, trialDays);

    const upsert = await supabase
      .from('usuarios')
      .upsert({
        id_telegram: tgId,
        username,
        estado: 'trial',
        fecha_inicio: fecha_inicio.toISOString(),
        fecha_expira: fecha_expira.toISOString()
      }, { onConflict: 'id_telegram' })
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

    await tgSendMessage(tgId, [
      '🎁 <b>Prueba VIP activada</b> (15 días).',
      'Haz clic para unirte al grupo VIP:',
      inviteLink,
      '',
      '🔔 Al finalizar tu prueba, podrás elegir continuar como <b>Premium</b>.',
    ].join('\n'));

    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    console.error('webhook error', e);
    return { statusCode: 200, body: 'error' };
  }
};
