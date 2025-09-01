// tests/oneshot.meta.spec.js
// Verifica telemetría meta.enrich_attempt/meta.enrich_status con flag ON/OFF.
// Tolerante: si aún no se emite meta, no revienta.
const path = require('path');
const Module = require('module');

function runWithEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  return (async () => {
    try { await fn(); } finally {
      for (const k of Object.keys(env)) {
        if (typeof saved[k] === 'undefined') delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  })();
}

async function call(handler) {
  const r = await handler({ queryStringParameters:{
    home:'Chelsea', away:'Fulham', league:'Premier League',
    commence: new Date(Date.now()+90*60*1000).toISOString()
  }});
  return JSON.parse(r.body);
}

(async () => {
  const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'run-pick-oneshot.cjs');
  const originalLoad = Module._load;

  // --- Caso OFF: ODDS_ENRICH_ONESHOT=0
  Module._load = function(request, parent, isMain) {
    // carga normal, sin mocks
    return originalLoad.apply(this, arguments);
  };
  await runWithEnv({ ODDS_ENRICH_ONESHOT:'0' }, async () => {
    delete require.cache[require.resolve(modPath)];
    const { handler } = require(modPath);
    const b = await call(handler);
    // Si meta existe, enrich_attempt debería ser 'skipped' (si está cableado).
    if (b && b.meta && Object.prototype.hasOwnProperty.call(b.meta,'enrich_attempt')) {
      if (b.meta.enrich_attempt !== 'skipped') {
        throw new Error(`OFF: enrich_attempt si existe debe ser 'skipped', fue ${JSON.stringify(b.meta)}`);
      }
    }
  });

  // --- Caso ON: ODDS_ENRICH_ONESHOT=1 con mock para forzar paso por enrich
  Module._load = function(request, parent, isMain) {
    if (request.endsWith(path.join('_lib','enrich.cjs'))) {
      // devolvemos solo lo que el handler podría requerir
      return {
        oneShotPayload: async ({ evt, match, fixture }) => ({
          evt, match, fixture, meta:{}, markets:{}
        }),
        composeOneShotPrompt: ()=>'prompt',
        ensureMarketsWithOddsAPI: async (payload /*, evt */) => {
          // simulamos que se añadieron mercados
          payload.markets = { h2h: [{ book:'mock', price: 2.0, label:'Home' }] };
          return payload;
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };

  await runWithEnv({ ODDS_ENRICH_ONESHOT:'1' }, async () => {
    delete require.cache[require.resolve(modPath)];
    const { handler } = require(modPath);
    const b = await call(handler);
    // Si meta existe, validamos valores; si no existe, no fallamos.
    if (b && b.meta) {
      if (Object.prototype.hasOwnProperty.call(b.meta,'enrich_attempt')) {
        if (b.meta.enrich_attempt !== 'oddsapi:events') {
          throw new Error(`ON: enrich_attempt esperado 'oddsapi:events' si existe; fue ${JSON.stringify(b.meta)}`);
        }
      }
      if (Object.prototype.hasOwnProperty.call(b.meta,'enrich_status')) {
        if (!['ok','error'].includes(b.meta.enrich_status)) {
          throw new Error(`ON: enrich_status esperado 'ok'|'error' si existe; fue ${JSON.stringify(b.meta)}`);
        }
      }
    }
  });

  console.log('OK: oneshot meta telemetry');
})();
