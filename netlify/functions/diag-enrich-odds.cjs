const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { enrichFixtureUsingOdds } = require('./_lib/enrich.cjs');

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
    // NO pasamos oddsRaw → fuerza el uso del fetch interno si hay ODDS_API_KEY
    const enriched = await enrichFixtureUsingOdds({ fixture: {
      fixture_id: match?.fixture_id,
      kickoff: evt.commence,
      league_id: match?.league_id,
      league_name: match?.league_name,
      country: match?.country,
      home_id: match?.home_id,
      away_id: match?.away_id,
    }});

    return {
      statusCode: 200,
      body: JSON.stringify({ evt, match: {
        fixture_id: match?.fixture_id,
        league_name: match?.league_name,
        confidence: match?.confidence,
        method: match?.method
      }, enriched }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
