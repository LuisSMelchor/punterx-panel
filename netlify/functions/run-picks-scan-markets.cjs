'use strict';

const scan = require('./run-picks-scan.cjs');
const { extractFromOddsAPI } = require('./_lib/markets-extract.cjs');
const { parseWeights, addClientScore } = require('./_lib/score.cjs');

exports.handler = async (event, context) => {
  const base = await scan.handler(event, context);
  let payload; try { payload = JSON.parse(base.body||'{}'); } catch { payload = {}; }

  try {
    const qs = (event && event.queryStringParameters) || {};
    const W = parseWeights(qs, process.env);

    // batch.results deben tener adjunta referencia/objeto con los datos de odds usados.
    // En muchos proyectos viene como r._rawOdds o r.src.oddsapi; aquí probamos varios lugares comunes:
    const results = payload?.batch?.results || [];
    for (const r of results) {
      const oddsRaw = r?.oddsapi || r?._odds || r?.src?.oddsapi || r?.raw || null;
      if (!oddsRaw) continue;
      // Solo completa si está vacío
      const need = (!r.score_btts || !r.score_ou25 || !r.score_dnb);
      if (!need) continue;
      const sc = extractFromOddsAPI(r?.evt, oddsRaw, {
        min_books_1x2: Number(qs.min_books_1x2)||undefined,
        min_books_btts: Number(qs.min_books_btts)||undefined,
        min_books_ou25: Number(qs.min_books_ou25)||undefined,
        min_books_dnb: Number(qs.min_books_dnb)||undefined
      });
      // No pisamos si ya existe un score > 0
      r.score_1x2 = (Number(r.score_1x2)||0) || sc.score_1x2;
      r.score_btts = (Number(r.score_btts)||0) || sc.score_btts;
      r.score_ou25 = (Number(r.score_ou25)||0) || sc.score_ou25;
      r.score_dnb  = (Number(r.score_dnb )||0) || sc.score_dnb;
      // unimos has_markets
      const prev = Array.isArray(r.has_markets) ? new Set(r.has_markets) : new Set();
      (sc.has_markets||[]).forEach(x=>prev.add(x));
      r.has_markets = Array.from(prev);
    }

    // calcula score_client + orden opcional
    if (Array.isArray(results) && results.length) {
      const ordered = addClientScore(results, W);
      if ((qs.order||'') === 'client') payload.batch.results = ordered;
      payload.batch.weights = W;
    }
  } catch (e) {
    // no-op
  }

  return {
    statusCode: base.statusCode || 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  };
};
