const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { oneShotPayload, composeOneShotPrompt } = require('./_lib/enrich.cjs');
const { callOneShotOpenAI, safeJson, computeEV } = require('./_lib/ai.cjs');
const { classifyEV, isPublishable } = require('./_lib/ev-rules.cjs');
const { fmtVIP, fmtFREE } = require('./_lib/format-msg.cjs');

let sendTG = null;
try { sendTG = require('../../send.js'); } catch { /* no-op si no existe */ }

exports.handler = async (event) => {
  try {
    if (process.env.FEATURE_ONESHOT !== '1') {
      return { statusCode: 200, body: JSON.stringify({ status: 'feature_off' }) };
    }

    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || '2025-08-24T23:00:00Z'
    };

    const match = await resolveTeamsAndLeague(evt, {});
    const fixture = {
      fixture_id: match?.fixture_id,
      kickoff: evt.commence,
      league_id: match?.league_id,
      league_name: match?.league_name,
      country: match?.country,
      home_id: match?.home_id,
      away_id: match?.away_id,
    };

    const payload = await oneShotPayload({ evt, match, fixture });
    const prompt = composeOneShotPrompt(payload);
    const raw = await callOneShotOpenAI(prompt);

    const parsed = safeJson(raw);
    if (!parsed) {
      return { statusCode: 200, body: JSON.stringify({ status: 'json_invalido', raw }) };
    }

    const ev = computeEV(parsed.apuesta_sugerida, parsed.probabilidad_estim);
    const ev2 = Number.isFinite(ev) ? Number(ev.toFixed(2)) : null;
    const nivel = classifyEV(ev2);

    const bundle = {
      fixture: payload.fixture,
      ia: parsed,
      ev: ev2,
      markets: payload.markets
    };

    let text;
    if (nivel === 'vip') text = fmtVIP(bundle);
    else if (nivel === 'free') text = fmtFREE(bundle);
    else return { statusCode: 200, body: JSON.stringify({ status: 'descartado', ev: ev2, parsed }) };

    // Envío (si está habilitado y send.js existe)
    const okToSend = process.env.SEND_TELEGRAM === '1' && isPublishable(nivel) && sendTG;
    let sent = false, target = null;

    if (okToSend) {
      const vipId = process.env.TELEGRAM_VIP_ID;      // -1002861902996 (ejemplo)
      const freeId = process.env.TELEGRAM_FREE_ID;    // @punterxpicks (si usas @, tu send debe soportarlo)
      target = (nivel === 'vip') ? vipId : freeId;
      if (target) {
        try {
          // send.js debe exponer sendMessage(chatId, text)
          await sendTG.sendMessage(target, text);
          sent = true;
        } catch (e) {
          if (Number(process.env.DEBUG_TRACE)) console.log('[TG] send fail', e?.message || e);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: sent ? 'sent' : 'preview',
        nivel,
        ev: ev2,
        target,
        text
      }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
