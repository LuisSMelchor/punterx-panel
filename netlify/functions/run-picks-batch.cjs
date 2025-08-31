'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');

/** Utils */
function marketSamples(markets = {}) {
  const out = {};
  for (const k of Object.keys(markets || {})) {
    const arr = markets[k];
    out[k] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}
function uniq(arr){ return Array.from(new Set(arr||[])); }
function keyOfBook(x){ return (x && (x.bookmaker || x.source || 'n/a')); }
function booksCount(arr=[]) { return new Set((arr||[]).map(keyOfBook).filter(Boolean)).size; }
function normalizePrices(arr=[]) {
  return arr.map(x => Number(x && x.price)).filter(v => Number.isFinite(v) && v>0).sort((a,b)=>a-b);
}
function median(prices){
  if (!prices.length) return 0;
  const n=prices.length;
  return n%2 ? prices[(n-1)/2] : 0.5*(prices[n/2-1]+prices[n/2]);
}

/** score compuesto 1x2 */
function score1x2_v2(markets = {}) {
  try {
    const h2x = markets['1x2'];
    if (!Array.isArray(h2x) || h2x.length < 2) return 0;
    const prices = normalizePrices(h2x);
    if (!prices.length) return 0;
    const mid  = median(prices);
    const best = prices[prices.length-1];
    if (!mid || !best) return 0;
    const raw  = (best/mid) - 1;                         // 0..+
    const bc   = Math.min(booksCount(h2x), 4) / 4;       // 0..1
    const n    = Math.min(h2x.length, 6) / 6;            // 0..1
    const edge = Math.min(Math.max(raw, 0), 0.25);       // cap 25%
    return 0.60*edge + 0.25*bc + 0.15*n;                 // 0..~0.25
  } catch(_){ return 0; }
}

exports.handler = async (event) => {
  let body = {};
  try { body = event && event.body ? JSON.parse(event.body) : {}; } catch(_){ body = {}; }

  const list = Array.isArray(body.events) ? body.events : [];
  const limit = Math.max(1, Math.min(Number(body.limit || 50), 200));
  const sleepMs = Number(process.env.BATCH_SLEEP_MS || 0);

  const min_h2x_len = Math.max(0, Number(body.min_h2x_len ?? 2));
  const require_markets = Array.isArray(body.require_markets) ? body.require_markets : [];
  const needBooks = Number(body.min_books_1x2 || process.env.RANK_MIN_BOOKS_1X2 || 1);

  const results = [];
  const skipped = [];

  for (const evt of list) {
    try {
      // payload base
      let payload = await oneShotPayload({
        evt,
        match: null,
        fixture: { kickoff: evt && evt.commence || null, league_name: evt && evt.league || null }
      }) || {};
      payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

      const before = Object.keys((payload && payload.markets) || {}).length;

      // enrich SAFE
      payload = await ensureMarketsWithOddsAPI(payload, evt || {});
      const after  = Object.keys((payload && payload.markets) || {}).length;

      // status/meta
      payload.meta.enrich_info   = Object.assign({ before, after, source:'oddsapi:ensure' }, payload.meta && payload.meta.enrich_info || {});
      payload.meta.enrich_status = (after > 0 ? 'ok' : 'error');

      // datos de 1x2 para filtros
      const h2xArr  = Array.isArray(payload.markets && payload.markets['1x2']) ? payload.markets['1x2'] : [];
      const h2xLen  = h2xArr.length;
      const books1x2= booksCount(h2xArr);

      // filtros rápidos
      if (min_h2x_len > 0 && h2xLen < min_h2x_len) {
        skipped.push({ evt, reason: `h2x_len<${min_h2x_len}`, h2x_len: h2xLen, markets_keys: Object.keys(payload.markets||{}) });
        if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
        continue;
      }
      if (require_markets.length && !require_markets.every(mk => {
        const v = payload.markets && payload.markets[mk];
        return Array.isArray(v) ? v.length>0 : !!v;
      })) {
        skipped.push({ evt, reason: `missing required markets: ${require_markets.join(',')}`, markets_keys: Object.keys(payload.markets||{}) });
        if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
        continue;
      }
      if (needBooks > 0 && books1x2 < needBooks) {
        skipped.push({ evt, reason: `min_books_1x2<${needBooks}`, h2x_len: h2xLen, books_1x2: books1x2 });
        if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
        continue;
      }

      // scoring (por ahora sólo 1x2)
      const s1x2 = score1x2_v2(payload.markets || {});
      const score = s1x2;

      results.push({
        evt,
        score,
        score_1x2: s1x2,
        market_samples: marketSamples(payload.markets || {}),
        has_markets: Object.keys(payload.markets||{}),
        h2x_len: h2xLen,
        payload_meta: payload.meta || {}
      });

      if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
    } catch (e) {
      results.push({ evt, score: 0, error: String((e && e.message) || e) });
    }
  }

  // ordenar y recortar
  const ranked = results.filter(r => !r.skipped).sort((a,b)=> (b.score - a.score));
  const kept   = ranked.slice(0, limit);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      count_in: list.length,
      count_ranked: ranked.length,
      count_skipped: skipped.length,
      results: kept,
      skipped: skipped.slice(0,50)
    })
  };
};
