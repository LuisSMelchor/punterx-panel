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
    // __FALLBACK_BATCH__
    /* __SCAN_EVENTS_FROM_ODDSAPI__: si no hay batch, construye uno básico desde OddsAPI */
    try {
      const qs = (event && event.queryStringParameters) || {};
      if (!payload || !payload.batch || !Array.isArray(payload.batch.results)) {
        const rq = eval('require');
        const https = rq('https');
        const path = rq('path');
        const { guessSportKeyFromLeague } = rq('./_lib/odds-helpers.cjs');

        const key    = process.env.ODDS_API_KEY || '';
        const sport  = String(qs.sport || guessSportKeyFromLeague(qs.league || process.env.LEAGUE_NAME) || process.env.SPORT_KEY || '').trim();
        const days   = Math.max(1, Number(qs.days || process.env.ODDS_SCAN_DAYS || 2));
        const limit  = Math.max(1, Number(qs.limit || 250));

        if (key && sport) {
          const url = new URL(`https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events`);
          url.searchParams.set('apiKey', key);
          url.searchParams.set('dateFormat', 'iso');

          const fetchJSON = (u) => new Promise((resolve) => {
            const req = https.get(u.toString(), (res) => {
              let data = "";
              res.on('data', (ch)=> data += ch);
              res.on('end', ()=>{
                try { resolve(JSON.parse(data)); } catch { resolve([]); }
              });
            });
            req.on('error', _=> resolve([]));
            req.end();
          });

          const events = await fetchJSON(url);
          const arr = Array.isArray(events) ? events.slice(0, limit) : [];
          const results = arr.map(e => ({
            evt: {
              provider: 'oddsapi',
              sport,
              id: e && e.id,
              commence_time: e && e.commence_time,
              home_team: e && e.home_team,
              away_team: e && e.away_team,
              sport_title: e && (e.sport_title || null)
            },
            status: 'scanned'
          }));

          payload = payload || {};
          payload.batch = payload.batch || {};
          payload.batch.results = Array.isArray(payload.batch.results) ? payload.batch.results : [];
          results.forEach(r => payload.batch.results.push(r));
          payload.batch.source = 'oddsapi_events';
          payload.batch.meta = Object.assign({}, payload.batch.meta||{}, { sport, days, limit });
        }
      }
    } catch (_) { /* no-op */ }

// si el scan cliente no generó batch.results,
    // construimos un batch mínimo usando oneShotPayload (canónico _lib/enrich.cjs).
    try {
      const qs = (event && event.queryStringParameters) || {};
      if (!payload || !payload.batch || !Array.isArray(payload.batch.results)) {
        const gen = await oneShotPayload({ qs, env: process.env });
        if (gen && gen.batch && Array.isArray(gen.batch.results)) {
          payload = gen; // sustituimos payload vacío por el generado canónicamente
        }
      }
    } catch (_) { /* no-op: devolvemos tal cual si falla */ }


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
