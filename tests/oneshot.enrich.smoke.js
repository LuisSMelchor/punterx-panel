// tests/oneshot.enrich.smoke.js
const path = require('path');
const enrich = require(path.join(__dirname, '..', 'netlify', 'functions', '_lib', 'enrich.cjs'));

(async () => {
  const saved = process.env.ODDS_API_KEY;

  // Case 0: sin API key -> null (no rompe)
  delete process.env.ODDS_API_KEY;
  let r = await enrich.fetchOddsForFixture({ home_name:'Chelsea', away_name:'Arsenal', league_name:'Premier League' });
  if (r !== null) throw new Error('Case 0: esperado null sin ODDS_API_KEY');

  // Case 1: con API key (si está en env) -> no debe explotar
  if (saved) {
    process.env.ODDS_API_KEY = saved;
    r = await enrich.fetchOddsForFixture({ home_name:'Chelsea', away_name:'Arsenal', league_name:'Premier League' });
    console.log('Case 1 (with key):', r ? 'objeto recibido' : 'null (sin match ahora)', 'OK');
  } else {
    console.log('Case 1 skipped: no ODDS_API_KEY set');
  }

  // restore env
  process.env.ODDS_API_KEY = saved;

  console.log('OK: oneshot.enrich.smoke');
})();
