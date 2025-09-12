// netlify/functions/admin-grant-vip.cjs
'use strict';

const { grantVipByTgId, revokeVipByTgId, getUserIdByTgId } = require('./_lib/_users.cjs');
const { tgSendDM } = require('./send.cjs');

// __send_report_base es opcional: si no existe, usamos stub local
function __send_report_stub() {
  return { enabled: false, results: [] };
}

module.exports.handler = async function (event) {
  const __send_report = (typeof __send_report_base === 'function'
    ? __send_report_base({})
    : __send_report_stub());

  try {
    if (!event || event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const AUTH_CODE = process.env.AUTH_CODE;
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}

    if (!AUTH_CODE || body.auth !== AUTH_CODE) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const tg_id = body.tg_id;
    const action = body.action;
    const plan_code = body.plan_code || 'VIP';
    const days = Number((body.days !== undefined && body.days !== null) ? body.days : 30);
    const notify = (body.notify === undefined || body.notify === null) ? true : !!body.notify;

    if (!tg_id || !action) {
      return { statusCode: 400, body: 'tg_id y action requeridos' };
    }

    // Política estricta: no crear si no existe
    const userId = await getUserIdByTgId(tg_id);
    if (!userId) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report, ok: false, error: 'user_not_found', tg_id }, null, 2)
      };
    }

    if (action === 'grant') {
      const ok = await grantVipByTgId(tg_id, { plan_code, days });
      let dm = false;
      if (ok && notify) {
        try {
          const msg = buildVipWelcomeMessage({ days, plan_code });
          const res = await tgSendDM(tg_id, msg);
          dm = !!(res && res.ok);
        } catch (e) {}
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report, ok, dm }, null, 2)
      };
    }

    if (action === 'revoke') {
      const ok = await revokeVipByTgId(tg_id);
      let dm = false;
      if (ok && notify) {
        try {
          const msg = buildVipGoodbyeMessage();
          const res = await tgSendDM(tg_id, msg);
          dm = !!(res && res.ok);
        } catch (e) {}
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report, ok, dm }, null, 2)
      };
    }

    return { statusCode: 400, body: 'action inválida' };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: __send_report, ok: false, error: String((e && e.message) || e) }, null, 2)
    };
  }
};

// ---------- Mensajes ----------
function buildVipWelcomeMessage({ days, plan_code }) {
  const diasTxt = (Number(days) > 0) ? String(days) + ' días' : 'acceso ilimitado';
  return [
    '🎟️ <b>¡Bienvenido a PunterX VIP!</b>',
    '',
    'Tu plan: <b>' + plan_code + '</b> — <i>' + diasTxt + '</i>',
    '',
    '🧭 <b>¿Qué vas a recibir?</b>',
    '• Picks PRE-MATCH detectados por nuestro radar 24/7.',
    '• Solo picks con <b>EV ≥ 15%</b> (Competitivo / Avanzado / Élite Mundial / Ultra Élite).',
    '• <i>Top 3 bookies</i> con la mejor cuota disponible.',
    '• Datos avanzados (clima, árbitro, historial, xG, lesiones) cuando aplique.',
    '',
    '🧩 <b>Cómo leer cada pick VIP</b>',
    '• <b>EV</b>: ventaja sobre la cuota del mercado.',
    '• <b>Probabilidad estimada</b> del modelo.',
    '• <b>Apuesta sugerida</b>: mercado/outcome exacto.',
    '• <b>Top 3 bookies</b>: casa y cuota, resaltando la mejor.',
    '',
    '📌 <b>Frecuencia</b>',
    'Ventana PRE-MATCH típica de 40–55 min (fallback 35–70).',
    '',
    '🤝 <b>Consejo</b>',
    'Usa <b>stake fijo</b> y respeta banca. El valor se ve a largo plazo.',
    '',
    '⚠️ <i>Responsabilidad</i>',
    'Contenido informativo. Apuesta con moderación.'
  ].join('\n');
}

function buildVipGoodbyeMessage() {
  return [
    'ℹ️ <b>Tu acceso VIP ha finalizado</b>',
    '',
    'Esperamos que te haya servido el radar de valor y el análisis.',
    'Cuando quieras regresar, estaremos listos. ¡Gracias por confiar en PunterX!',
    '',
    '<i>Juega responsablemente.</i>'
  ].join('\n');
}
