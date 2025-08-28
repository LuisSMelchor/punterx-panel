const path = require('path');
const modPath = path.join(__dirname, '..', 'netlify', 'functions', 'run-pick-oneshot.cjs');

// Mock del módulo enrich antes de cargar el handler
const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request.endsWith(path.join('_lib','enrich.cjs'))) {
    return {
      fetchOddsForFixture: async () => ({ mock: true, markets: { h2h: [] } }),
    };
  }
  return originalLoad.apply(this, arguments);
};

process.env.ODDS_ENRICH_ONESHOT = '1';

const { handler } = require(modPath);

(async () => {
  const r = await handler({ queryStringParameters: {
    home: 'Chelsea', away: 'Fulham', league: 'Premier League',
    commence: new Date(Date.now()+90*60*1000).toISOString()
  }});
  const b = JSON.parse(r.body);

  if (!b || b.ok !== true) throw new Error('expected ok=true');
  if (!b.meta || b.meta.odds_source !== 'oddsapi:events') {
    throw new Error('expected meta.odds_source="oddsapi:events" when enrich mocked');
  }
  if (!b.markets_top3 && !b.meta && !b.markets) {
    throw new Error('expected some markets/meta attached');
  }

  console.log('OK: oneshot.enrich.integration (mock)');
})();
