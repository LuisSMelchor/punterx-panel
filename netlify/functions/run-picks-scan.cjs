'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const scan = require('./run-picks-scan-client.cjs');
const { parseWeights, addClientScore } = require('./_lib/score.cjs');

exports.handler = async (event, context) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
// 1) Llama al scan original
  const base = await scan.handler(event, context);

  // 2) Intenta parsear body
  let payload;
  try { payload = JSON.parse(base.body || '{}'); } catch { payload = {}; }

  try {
    const qs = (event && event.queryStringParameters) || {};
    const W = parseWeights(qs, process.env);
    const batch = payload && payload.batch;

    if (batch && Array.isArray(batch.results)) {
      // 3) Aplica client score y orden opcional
      const ordered = addClientScore(batch.results, W);
      if ((qs.order || '') === 'client') batch.results = ordered;

      // 4) Expón pesos usados
      batch.weights = W;
    }
  } catch (e) {
    // no-op: si algo falla, devolvemos tal cual
  }

  return {
    statusCode: base.statusCode || 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
};
