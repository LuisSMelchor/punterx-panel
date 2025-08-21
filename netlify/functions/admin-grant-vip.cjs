// netlify/functions/admin-grant-vip.cjs
'use strict';

const { grantVipByTgId, revokeVipByTgId, getUserIdByTgId } = require('./_lib/_users.cjs');
const { tgSendDM } = require('./send.js');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { AUTH_CODE } = process.env;
    const body = JSON.parse(event.body || '{}');
    if (!AUTH_CODE || body.auth !== AUTH_CODE) return { statusCode: 401, body: 'Unauthorized' };

    const { tg_id, action, plan_code = 'VIP', days = 30, notify = true } = body;
    if (!tg_id || !action) return { statusCode: 400, body: 'tg_id y action requeridos' };

    // ✅ Política estricta: no crear si no existe
    const userId = await getUserIdByTgId(tg_id);
    if (!userId) {
      return {
        statusCode: 404,
        body: JSON.stringify({ ok: false, error: 'user_not_found', tg_id })
      };
    }

    if (action === 'grant') {
      const ok = await grantVipByTgId(tg_id, { plan_code, days });
      let dm = false;
      if (ok && notify) {
        try {
          const msg = buildVipWelcomeMessage({ days, plan_code });
          const res = await tgSendDM(tg_id, msg);
          dm = !!res?.ok;
        } catch (e) {}
      }
      return { statusCode: 200, body: JSON.stringify({ ok, dm }) };
    }

    if (action === 'revoke') {
      const ok = await revokeVipByTgId(tg_id);
      let dm = false;
      if (ok && notify) {
        try {
          const msg = buildVipGoodbyeMessage();
          const res = await tgSendDM(tg_id, msg);
          dm = !!res?.ok;
        } catch (e) {}
      }
      return { statusCode: 200, body: JSON.stringify({ ok, dm }) };
    }

    return { statusCode: 400, body: 'action inválida' };
  } catch (e) {
    return { statusCode: 500, body: e?.message || 'error' };
  }
};

// … (deja tus funciones buildVipWelcomeMessage / buildVipGoodbyeMessage igual)

/**
 * Mensaje de bienvenida VIP (HTML)
 * Mantiene el estilo: Resumen → Acción → Detalle
 * y respeta el formato de los picks que verán en el grupo VIP.
 */
function buildVipWelcomeMessage({ days, plan_code }) {
  const diasTxt = (Number(days) > 0) ? `${days} días` : 'acceso ilimitado';
  return [
    '🎟️ <b>¡Bienvenido a PunterX VIP!</b>',
    '',
    `Tu plan: <b>${plan_code}</b> — <i>${diasTxt}</i>`,
    '',
    '🧭 <b>¿Qué vas a recibir?</b>',
    '• Picks PRE‑MATCH detectados por nuestro radar 24/7.',
    '• Solo picks con <b>EV ≥ 15%</b> (clasificados en Competitivo / Avanzado / Élite Mundial / Ultra Élite).',
    '• <i>Top 3 bookies</i> con la mejor cuota disponible.',
    '• Datos avanzados: clima, árbitro, historial, xG y lesiones cuando aplique.',
    '',
    '🧩 <b>Cómo leer cada pick VIP</b>',
    '• <b>EV</b>: Ventaja estadística sobre la cuota del mercado.',
    '• <b>Probabilidad estimada</b>: cálculo del modelo IA (5–85%).',
    '• <b>Apuesta sugerida</b>: mercado/outcome exacto, listo para copiar.',
    '• <b>Apuestas extra</b>: alternativas (totales, ambos anotan, hándicap, etc.).',
    '• <b>Top 3 bookies</b>: casa y cuota, resaltando la mejor.',
    '',
    '📌 <b>Frecuencia</b>',
    'Trabajamos la ventana PRE‑MATCH de <b>40–55 min</b> (fallback 35–70). Los picks llegan cuando hay valor real.',
    '',
    '🤝 <b>Consejo</b>',
    'Usa <b>stake fijo</b> y respeta banca. El valor se ve en el largo plazo.',
    '',
    '⚠️ <i>Responsabilidad</i>',
    'Contenido informativo. Apuesta con moderación y solo dinero que puedas permitirte perder.',
  ].join('\n');
}

/**
 * Mensaje de revocación (opcional)
 */
function buildVipGoodbyeMessage() {
  return [
    'ℹ️ <b>Tu acceso VIP ha finalizado</b>',
    '',
    'Esperamos que te haya servido el radar de valor y el análisis avanzado.',
    'Cuando quieras regresar, estaremos listos. ¡Gracias por confiar en PunterX!',
    '',
    '<i>Juega responsablemente.</i>'
  ].join('\n');
}
