'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const scan = require('./run-picks-scan.cjs'); // reutiliza tu handler actual
const { parseWeights, addClientScore } = require('./_lib/score.cjs');

exports.handler = async (event, context) => {
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
