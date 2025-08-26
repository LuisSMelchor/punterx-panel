const { resolveTeamsAndLeague } = require('../netlify/functions/_lib/af-resolver.cjs');

async function run(evt) {
  const out = await resolveTeamsAndLeague(evt, {});
  const method = out?.method || 'null';
  const conf = typeof out?.confidence === 'number' ? out.confidence.toFixed(2) : 'NA';
  console.log(`[SMOKE] ${evt.home} vs ${evt.away} | ${evt.league} | ${evt.commence} -> method=${method} conf=${conf} fx=${out?.fixture_id || 'null'}`);
}

(async () => {
  await run({ home:'Charlotte FC', away:'New York Red Bulls', league:'Major League Soccer', commence:'2025-08-24T23:00:00Z' });
  await run({ home:'Charlotte FC', away:'New York Red Bulls', league:'Major League Soccer', commence:'2025-08-19T23:00:00Z' });
  // agrega más casos cuando quieras
})();
