const { resolveTeamsAndLeague } = require('../netlify/functions/_lib/af-resolver.cjs');

(async () => {
  // Usar variables que no choquen con el entorno del sistema (HOME=/home/codespace, etc.)
  const evt = {
    home: process.env.HOME_TEAM || 'Charlotte FC',
    away: process.env.AWAY_TEAM || 'New York Red Bulls',
    league: process.env.LEAGUE_NAME || 'Major League Soccer',
    commence: process.env.COMMENCE_UTC || '2025-08-24T23:00:00Z'
  };

  const out = await resolveTeamsAndLeague(evt, {});
  console.log('RESULT:');
  console.dir(out, { depth: 6 });

  // Resumen legible (si el resolver expone debug)
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
