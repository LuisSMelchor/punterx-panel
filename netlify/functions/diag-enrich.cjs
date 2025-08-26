const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
// fetchOddsForFixture existe pero aún no lo usamos aquí para no exponer secretos
exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || '2025-08-24T23:00:00Z'
    };
    const match = await resolveTeamsAndLeague(evt, {});
    return { statusCode: 200, body: JSON.stringify({ evt, match }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
