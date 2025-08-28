// tests/oneshot.servererror.spec.js
// Verifica soft-fail cuando la IA lanza error.
// Tolerante con ALLOW_500_ONESHOT=1 (en ese caso puede devolver 500 y no debe fallar).

const path = require('path');
const Module = require('module');

(async () => {
  const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'run-pick-oneshot.cjs');
  const originalLoad = Module._load;

  // Mock del módulo de IA para forzar error
  Module._load = function(request, parent, isMain) {
    if (request.endsWith(path.join('_lib', 'ai.cjs'))) {
      return {
        callOpenAIOnce: async () => { throw new Error('boom-ai'); },
      };
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    const { handler } = require(modPath);
    const r = await handler({ queryStringParameters: {
      home: 'Chelsea', away: 'Fulham', league: 'Premier League',
      commence: new Date(Date.now() + 90*60*1000).toISOString()
    }});

    if (typeof r !== 'object' || typeof r.statusCode !== 'number') {
      throw new Error('handler no devolvió un objeto HTTP válido');
    }

    const expectSoft200 = String(process.env.ALLOW_500_ONESHOT) !== '1';
    if (expectSoft200 && r.statusCode !== 200) {
      throw new Error(`statusCode esperado 200 en soft-fail; fue ${r.statusCode}`);
    }

    const b = JSON.parse(r.body);
    if (b.ok !== false) throw new Error('esperado ok:false en soft-fail');
    if (!b.meta || typeof b.meta !== 'object') throw new Error('meta debe ser objeto en soft-fail');

    console.log('OK: oneshot server-error soft-fail');
  } finally {
    Module._load = originalLoad;
  }
})();
