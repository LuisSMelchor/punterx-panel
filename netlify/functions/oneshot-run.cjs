const enrich = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

// Alias seguro: si no hay oneShotPayload, usa buildOneShotPayload
const buildOneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 60*60*1000).toISOString(),
    };

    // Resolver AF (requiere API_FOOTBALL_KEY para resultados reales)
    let match = {};
    try {
      match = await resolveTeamsAndLeague(evt, {});
    } catch (e) {
      match = { ok: false, method: 'none', reason: 'resolver_error', error: e?.message };
    }

    // Fixture mínimo a enriquecer
    const fixture = {
      fixture_id: match?.fixture_id ?? null,
      kickoff: evt.commence,
      league_id: match?.league_id ?? null,
      league_name: match?.league_name ?? evt.league,
      country: match?.country ?? null,
      home_id: match?.home_id ?? null,
      away_id: match?.away_id ?? null,
    };

    // Enriquecimiento (si hay ODDS_API_KEY intentará fetch; sino, solo normaliza campos)
    const enriched = await enrich.enrichFixtureUsingOdds({ fixture });

    // Construir payload one-shot consistente
    const payload = await buildOneShot({ evt, match, enriched });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};
