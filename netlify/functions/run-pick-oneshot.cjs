'use strict';
const { oneShotPayload, composeOneShotPrompt, runOneShotAI } = require('./_lib/enrich.cjs');
const { formatVipMessage, formatFreeMessage } = require('./_lib/format.cjs');
const { savePickToSupabase } = require('./_lib/store.cjs');

function classify(ev) {
  if (typeof ev !== 'number') return 'Descartar';
  if (ev >= 15) return 'VIP';
  if (ev >= 10) return 'Gratis';
  return 'Descartar';
}

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || '2025-08-24T23:00:00Z'
    };

    // Enriquecimiento mínimo de demo; en próximos pasos conectaremos OddsAPI/API-FOOTBALL
    const payload = await oneShotPayload({ evt, match: {}, fixture: {} });
    const prompt  = composeOneShotPrompt(payload);
    const ai = await runOneShotAI({ prompt, payload });

    // Si no corrió la IA (falta OPENAI_API_KEY), devolvemos info mínima
    if (!ai?.ok) {
      return { statusCode: 200, body: JSON.stringify({ ok:false, reason: ai?.reason || 'no-ai', payload, prompt }) };
    }

    const ev = (typeof ai.result?.ev_estimado === 'number') ? ai.result.ev_estimado : null;
    const lane = classify(ev);

    let message = '';
    if (lane === 'VIP') {
      message = formatVipMessage({ payload, ai });
    } else if (lane === 'Gratis') {
      message = formatFreeMessage({ payload, ai });
    } else {
      message = 'Sin valor suficiente (EV < 10%).';
    }

    // Guardar en Supabase (si hay ENV); respeta tu esquema
    const row = {
      evento: `${payload.equipos?.local} vs ${payload.equipos?.visita}`,
      analisis: message,
      apuesta: ai.result?.apuesta_sugerida?.seleccion || null,
      tipo_pick: lane,
      liga: payload.liga + (payload.pais ? ` (${payload.pais})` : ''),
      equipos: `${payload.equipos?.local} vs ${payload.equipos?.visita}`,
      ev: ev,
      probabilidad: ai.result?.probabilidad_estim ?? null,
      nivel: ai.result?.nivel ?? null,
      timestamp: new Date().toISOString()
    };
    const saved = await savePickToSupabase(row);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        lane,
        ev,
        message,
        saved,
        preview: { payload, ai: ai.result }
      }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
