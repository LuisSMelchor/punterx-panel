'use strict';

// Ejecutar con: node tests/flags.smoke.spec.js
const assert = require('assert');

async function call(handler, env = {}, qs = {}) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const r = await handler({ queryStringParameters: {
      home: qs.home || 'Chelsea',
      away: qs.away || 'Fulham',
      league: qs.league || 'Premier League',
      commence: qs.commence || new Date(Date.now()+60*60*1000).toISOString(),
    }});
    const body = JSON.parse(r.body || '{}');
    return { status: r.statusCode, body };
  } finally {
    for (const k of Object.keys(env)) {
      if (typeof prev[k] === 'undefined') delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

(async () => {
  const { handler } = require('../netlify/functions/run-pick-oneshot.cjs');

  // Caso A: ODDS_ENRICH_ONESHOT=1 → meta.enrich_attempt/odds_source presentes; markets_top3 existe
  {
    const { status, body } = await call(handler, {
      ODDS_ENRICH_ONESHOT: '1',
      DISABLE_OPENAI: '1',        // evita red; caminos “server-error” siguen entregando contrato
      SEND_ENABLED: '1',          // habilita send_report IIFE
    });
    assert.ok([200,500].includes(status), 'status esperado 200/500');
    assert.ok(body && typeof body === 'object', 'body object');
    assert.ok(body.meta && body.meta.enrich_attempt === 'oddsapi:events', 'meta.enrich_attempt');
    assert.ok(body.meta && body.meta.odds_source === 'oddsapi:events', 'meta.odds_source');
    assert.ok(body.markets_top3 && typeof body.markets_top3 === 'object', 'markets_top3 objeto');
    console.log('[Flags:A] ✅ OK');
  }

  // Caso B: ODDS_ENRICH_ONESHOT=0 → meta.enrich_attempt='skipped'; no exigir odds_source
  {
    const { status, body } = await call(handler, {
      ODDS_ENRICH_ONESHOT: '0',
      DISABLE_OPENAI: '1',
      SEND_ENABLED: '1',
    });
    assert.ok([200,500].includes(status), 'status esperado 200/500');
    assert.ok(body && body.meta && body.meta.enrich_attempt === 'skipped', 'meta.enrich_attempt=skipped');
    console.log('[Flags:B] ✅ OK');
  }

  // Caso C (suave): FREE_INCLUDE_BOOKIES=1 → si message_free existe, puede contener “Top 3 bookies”
  // No fallamos si message_free es null (depende de EV y odds) — smoke permisivo.
  {
    const { status, body } = await call(handler, {
      ODDS_ENRICH_ONESHOT: '1',
      DISABLE_OPENAI: '1',
      SEND_ENABLED: '1',
      FREE_INCLUDE_BOOKIES: '1',
      MIN_VIP_EV: '99', // fuerza que típicamente vaya a FREE si nivel es informativo
    });
    assert.ok([200,500].includes(status), 'status esperado 200/500');
    if (typeof body.message_free === 'string') {
      // sólo chequeo de presencia de etiqueta; no obligamos formato exacto
      assert.ok(/Top\s*3\s*bookies/i.test(body.message_free), 'FREE incluye Top 3 bookies');
    }
    console.log('[Flags:C] ✅ OK (soft)');
  }

  console.log('OK: flags smoke');
})().catch((e) => {
  console.error('FAIL:', e && e.message || e);
  process.exit(1);
});
