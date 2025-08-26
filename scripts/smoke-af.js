const { resolveTeamsAndLeague } = require('../netlify/functions/_lib/af-resolver.cjs');

(async () => {
  const evt = {
    home: process.env.HOME || 'Charlotte FC',
    away: process.env.AWAY || 'New York Red Bulls',
    league: process.env.LEAGUE || 'Major League Soccer',
    commence: process.env.COMMENCE || '2025-08-24T23:00:00Z'
  };
  const out = await resolveTeamsAndLeague(evt, {});
  console.log('RESULT:');
  console.dir(out, { depth: 6 });
  // Resumen legible
  const dbg = out?.debug || {};
  console.log('\nSUMMARY:',
    JSON.stringify({
      method: out?.method,
      fixture_id: out?.fixture_id,
      confidence: out?.confidence,
      fixturesChecked: dbg.fixturesChecked,
      searchChecked: dbg.searchChecked
    }, null, 2)
  );
})().catch(e => {
  console.error('SMOKE ERROR:', e?.message || e);
  process.exit(1);
});
