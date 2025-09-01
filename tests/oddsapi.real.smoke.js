'use strict';
const assert = require('assert');
(async () => {
  const { handler } = require('../netlify/functions/run-pick-oneshot.cjs');
  process.env.ODDS_ENRICH_ONESHOT = '1';
  // Requiere ODDS_API_KEY en env y nombres válidos:
  const r = await handler({ queryStringParameters:{
    home:'FC Barcelona', away:'Sevilla FC', league:'La Liga',
    commence: new Date(Date.now()+90*60*1000).toISOString()
  }});
  const body = JSON.parse(r.body||'{}');
  assert.ok(body.meta && body.meta.enrich_attempt==='oddsapi:events','meta.enrich_attempt');
  assert.ok(body.markets_top3 && typeof body.markets_top3==='object','markets_top3 object');
  console.log('OK: real odds smoke', { enrich_status: body.meta.enrich_status });
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
