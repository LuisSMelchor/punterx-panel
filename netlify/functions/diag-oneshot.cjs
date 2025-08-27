const enrich = require('./_lib/enrich.cjs');
const oneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now()+60*60*1000).toISOString()
    };
    const match = {}; // diagnóstico simple
    const fixture = { kickoff: evt.commence, league_name: evt.league };

    const payload = await oneShot({ evt, match, fixture });
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
