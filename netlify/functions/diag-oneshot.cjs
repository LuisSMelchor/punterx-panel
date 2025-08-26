const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { oneShotPayload } = require('./_lib/enrich.cjs');

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
    const fixture = {
      fixture_id: match?.fixture_id,
      kickoff: evt.commence,
      league_id: match?.league_id,
      league_name: match?.league_name,
      country: match?.country,
      home_id: match?.home_id,
      away_id: match?.away_id,
    };

    const payload = await oneShotPayload({ evt, match, fixture });
    return { statusCode: 200, body: JSON.stringify(payload, null, 2) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
