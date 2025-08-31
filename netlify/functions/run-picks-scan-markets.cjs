'use strict';

const scan = require('./run-picks-scan.cjs');
const { extractFromOddsAPI } = require('./_lib/markets-extract.cjs');
const { attachOddsForResults } = require('./_lib/attach-odds.cjs');
const { parseWeights, addClientScore } = require('./_lib/score.cjs');

exports.handler = async (event, context) => {
  const base = await scan.handler(event, context);
  let payload; try { payload = JSON.parse(base.body||'{}'); } catch { payload = {}; }

  try {
    const qs = (event && event.queryStringParameters) || {};
    const W = parseWeights(qs, process.env);
    const results = payload?.batch?.results || [];

    for (const r of results) {
      /*__ODDSRAW_PATHS__*/
      const oddsRaw =
        r?.oddsapi ||
        r?._odds ||
        r?.src?.oddsapi ||
        r?.raw ||
        r?.odds ||
        (Array.isArray(r?.bookmakers) ? { bookmakers: r.bookmakers } : null);

      if (!oddsRaw) continue;

      const need = (!Number(r.score_btts) && !Number(r.score_ou25) && !Number(r.score_dnb));
      const sc = extractFromOddsAPI(r?.evt, oddsRaw, {
        min_books_1x2: Number(qs.min_books_1x2)||undefined,
        min_books_btts: Number(qs.min_books_btts)||undefined,
        min_books_ou25: Number(qs.min_books_ou25)||undefined,
        min_books_dnb: Number(qs.min_books_dnb)||undefined
      });

      /*__COERCE_NUMBERS__*/
      r.score_1x2 = (Number(r.score_1x2)||0) || Number(sc.score_1x2)||0;
      r.score_btts = (Number(r.score_btts)||0) || Number(sc.score_btts)||0;
      r.score_ou25 = (Number(r.score_ou25)||0) || Number(sc.score_ou25)||0;
      r.score_dnb  = (Number(r.score_dnb )||0) || Number(sc.score_dnb )||0;

      // fusiona has_markets
      const hs = new Set([...(r.has_markets||[]), ...(sc.has_markets||[])]);
      r.has_markets = Array.from(hs);
    }

    // calcula score_client y opcionalmente ordena
    if (payload?.batch?.results) {
      const ordered = addClientScore(payload.batch.results, W);
      if ((qs.order || '') === 'client') payload.batch.results = ordered;
      payload.batch.weights = W;
/*__COUNT_BOOKMAKERS__*/
payload.__bookmakers_after = results.filter(r=>Array.isArray(r?.bookmakers)&&r.bookmakers.length).length;
payload.__bookmakers_after = results.filter(r => Array.isArray(r?.bookmakers) && r.bookmakers.length).length;
    }

    /*__DEBUG_MARKETS__*/
    if (String(qs.debug_markets||'') === '1') {
      payload.__markets_debug__ = (payload.batch?.results||[]).slice(0,3).map(r => ({
        fx: r?.evt ? `${r.evt.home} vs ${r.evt.away}` : null,
        paths_found: {
          oddsapi: !!r?.oddsapi,
          _odds: !!r?._odds,
          src_oddsapi: !!r?.src?.oddsapi,
          raw: !!r?.raw,
          odds: !!r?.odds,
          bookmakers: Array.isArray(r?.bookmakers)
        }
      }));
    }
  } catch(e) {
    // no-op
  }

  return {
    statusCode: base.statusCode || 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  };
};
