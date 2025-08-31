'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');

// --- helpers ---
function marketSamples(markets = {}) {
  const out = {};
  for (const k of Object.keys(markets||{})) {
    const arr = markets[k];
    out[k] = Array.isArray(arr) ? arr.length : 0;
  }
  return out;
}

// === [AUTO-INJECT score.v2] ===
function uniq(arr){ return Array.from(new Set(arr||[])); }

function booksCount1x2(markets = {}) {
  const h2x = markets['1x2'];
  if (!Array.isArray(h2x)) return 0;
  // Fallback: si no hay "bookmaker", usamos "source" o "n/a" para no quedarnos en 0
  const keyOf = x => (x && (x.bookmaker || x.source || 'n/a'));
  return uniq(h2x.map(keyOf).filter(Boolean)).length;
}

function score1x2_v2(markets = {}) {
  try {
    const h2x = markets['1x2'];
    if (!Array.isArray(h2x) || h2x.length < 2) return 0;

    const prices = h2x.map(x => Number(x && x.price)).filter(v => v > 0).sort((a,b)=>a-b);
    if (!prices.length) return 0;

    const mid = (prices.length % 2)
      ? prices[(prices.length - 1) / 2]
      : 0.5 * (prices[prices.length/2 - 1] + prices[prices.length/2]);

    const best = prices[prices.length - 1];
    if (!mid || !best) return 0;

    const raw  = (best / mid) - 1;                        // edge vs mediana
    const bc   = Math.min(booksCount1x2(markets), 4) / 4; // diversidad 0..1
    const n    = Math.min(h2x.length, 6) / 6;             // tamaño muestra 0..1
    const edge = Math.min(Math.max(raw, 0), 0.25);        // cap 25%

    // mezcla: 60% edge, 25% diversidad, 15% muestra
    return 0.60*edge + 0.25*bc + 0.15*n;
  } catch(_) { return 0; }
}
// === [/AUTO-INJECT score.v2] ===

exports.handler = async (event) => {
  let body = {};
  try { body = event?.body ? JSON.parse(event.body) : {}; } catch(_){ body = {}; }

  const list    = Array.isArray(body.events) ? body.events : [];
  const limit   = Math.max(1, Math.min(Number(body.limit || 50), 200));
  const sleepMs = Number(process.env.BATCH_SLEEP_MS || 0);

  // filtros
  const min_h2x_len     = Math.max(0, Number((body.min_h2x_len ?? 3)));
  const require_markets = Array.isArray(body.require_markets) ? body.require_markets : [];
  const needBooks       = Number(body.min_books_1x2 || process.env.RANK_MIN_BOOKS_1X2 || 1);

  const results = [];
  const skipped = [];

  for (const evt of list) {
    try {
      // payload base
      let payload = await oneShotPayload({
        evt,
        match: null,
        fixture: { kickoff: evt?.commence || null, league_name: evt?.league || null }
      }) || {};
      payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
      const before = Object.keys(payload?.markets||{}).length;

      // enrich SAFE
      payload = await ensureMarketsWithOddsAPI(payload, evt || {});
      const after  = Object.keys(payload?.markets||{}).length;

      // status/meta
      payload.meta.enrich_info   = Object.assign({ before, after, source:'oddsapi:ensure' }, payload.meta?.enrich_info || {});
      payload.meta.enrich_status = (after > 0 ? 'ok' : 'error');

      // métricas de mercados
      const h2xArr  = Array.isArray(payload.markets?.['1x2']) ? payload.markets['1x2'] : [];
      const h2xLen  = h2xArr.length;
      const anyBook = h2xArr.some(x => x && (x.bookmaker || x.source));
      const books12 = booksCount1x2(payload.markets || {});

      // filtros rápidos
      if (min_h2x_len > 0 && h2xLen < min_h2x_len) {
        skipped.push({ evt, reason: `h2x_len<${min_h2x_len}`, h2x_len: h2xLen, markets_keys: Object.keys(payload.markets||{}) });
      } else if (require_markets.length && !require_markets.every(mk => {
        const v = payload.markets?.[mk];
        return Array.isArray(v) ? v.length>0 : !!v;
      })) {
        skipped.push({ evt, reason: `missing required markets: ${require_markets.join(',')}`, markets_keys: Object.keys(payload.markets||{}) });
      } else if (anyBook && books12 < needBooks) {
        // Solo aplicamos el umbral si hay algún "bookmaker|source" presente;
        // si no hay, no bloqueamos por libros para no saltarnos todo el set.
        skipped.push({ evt, reason: `min_books_1x2<${needBooks}`, h2x_len: h2xLen, books_1x2: books12 });
      } else {
        // ---- scoring (por ahora sólo 1x2) ----
        const s1x2  = score1x2_v2(payload.markets || {});
        const score = s1x2; // hook para score compuesto multi-mercado
        results.push({
          evt,
          score,
          score_1x2: s1x2,
          market_samples: marketSamples(payload.markets || {}),
          has_markets: Object.keys(payload.markets||{}),
          h2x_len: h2xLen,
          payload_meta: payload.meta || {}
        });
      }

      if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
    } catch (e) {
      results.push({ evt, score: 0, error: String(e?.message || e) });
    }
  }

  // ordenar por score desc
  const ranked = results.sort((a,b) => (b.score - a.score));
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
      skipped: skipped.slice(0, 100) // por si acaso
    })
  };
};
