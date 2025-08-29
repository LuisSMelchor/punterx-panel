const path = require('path');
const Module = require('module');
const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'run-pick-oneshot.cjs');

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
  const originalLoad = Module._load;

  // Mock del módulo enrich para controlar el efecto
  Module._load = function(request, parent, isMain) {
    if (request.endsWith(path.join('_lib','enrich.cjs'))) {
      return {
        oneShotPayload: async ({ evt }) => ({
          fixture: { league_name: evt.league },
          markets: {}, // sin mercados → forzará enriquecimiento si el flag está activo
          meta: { odds_source: 'none' }
        }),
        composeOneShotPrompt: () => 'dummy',
        ensureMarketsWithOddsAPI: async (payload) => {
          // Simula adjuntar mercados y meta desde OddsAPI
          return {
            ...payload,
            markets: { h2h: [{ book:'Mock', price:1.91, label:'Home' }] },
            meta: { ...(payload.meta||{}), odds_source: 'oddsapi:events' }
          };
        }
      };
    }
    return originalLoad.apply(this, arguments);
  };

  // 1) Opt-out: NO debe enriquecerse
  await runWithEnv({ ODDS_ENRICH_ONESHOT: '0' }, async () => {
    delete require.cache[require.resolve(modPath)];
    const { handler } = require(modPath);
    const b = await call(handler);
    if (b?.meta?.odds_source === 'oddsapi:events') {
      throw new Error('opt-out: no debería enriquecerse con flag=0');
    }
  });

  // 2) Opt-in: SÍ debe enriquecerse
  await runWithEnv({ ODDS_ENRICH_ONESHOT: '1' }, async () => {
    delete require.cache[require.resolve(modPath)];
    const { handler } = require(modPath);
    const b = await call(handler);
    if (b?.meta?.odds_source !== 'oddsapi:events') {
      throw new Error('opt-in: se esperaba odds_source="oddsapi:events"');
    }
    if (!b.markets_top3 && !b.markets) {
      throw new Error('opt-in: se esperaban markets adjuntos');
    }
  });

  // restaurar loader
  Module._load = originalLoad;

  console.log('OK: oneshot wire integration');
})();
