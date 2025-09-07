'use strict';
const af = require('./_lib/resolver-af.cjs');

exports.handler = async (event) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    const req = {
      home: (qs.home || qs.h || '').trim(),
      away: (qs.away || qs.a || '').trim(),
      league_hint: (qs.league_hint || qs.l || '').trim(),
      country_hint: (qs.country_hint || qs.c || '').trim(),
      when_text: (qs.when_text || qs.d || '').trim()
    };
    const out = await (af && af.resolveTeamsAndLeague
      ? af.resolveTeamsAndLeague(req, { verbose: 1 })
      : Promise.resolve({}));

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        fixture_id: out && (out.fixture_id || null),
        league: out && (out.league || null),
        country: out && (out.country || null),
        when_text: out && (out.when_text || null),
        _debug: out && out._debug ? out._debug : null
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: String((e && e.stack) || (e && e.message) || e || 'internal error')
    };
  }
};
