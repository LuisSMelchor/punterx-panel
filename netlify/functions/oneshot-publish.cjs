const enrich = require('./_lib/enrich.cjs');
const oneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now()+60*60*1000).toISOString()
    };
    const match = await resolveTeamsAndLeague(evt, {});
    const fixture = {
      fixture_id: match?.fixture_id,
      kickoff: evt.commence,
      league_id: match?.league_id,
      league_name: match?.league_name || evt.league,
      country: match?.country,
      home_id: match?.home_id,
      away_id: match?.away_id
    };

    const payload = await oneShot({ evt, match, fixture });
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ published: false, preview: true, payload }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
