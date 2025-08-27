'use strict';
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

    // 1) Resolver AF (opcional; no debe bloquear enriquecimiento)
    let match = {};
    try {
      match = await resolveTeamsAndLeague(evt, {});
    } catch (e) {
      match = { ok: false, method: 'none', reason: 'resolver_error', error: e?.message };
    }

    // 2) Determinar kickoff (preferir AF si lo trae; si no, el evt.commence)
    const kickoff =
      match?.kickoff ||
      match?.fixture?.date ||
      evt.commence;

    // 3) Armar fixture mínimo con los campos que el enriquecedor espera
    const fixture = {
      fixture_id: match?.fixture_id ?? null,
      kickoff,
      league_name: evt.league,     // ¡IMPORTANTE!
      country: null,
      home_name: evt.home,         // ¡IMPORTANTE!
      away_name: evt.away,         // ¡IMPORTANTE!
      home_id: match?.homeId ?? null,
      away_id: match?.awayId ?? null,
    };

    // 4) Enriquecer con Odds (aunque AF no haya resuelto)
    let enriched = {};
    try {
      enriched = await enrich.enrichFixtureUsingOdds({ fixture });
    } catch (e) {
      enriched = { error: e?.message || String(e) };
    }

    // 5) Payload/Preview
    const payload = {
      status: 'preview',
      level: 'info',
      evt,
      match,
      enriched,
      markets: {}, // reservado si luego quieres incluir markets_raw
      when_text: enriched?.when_text ?? null,
      league: enriched?.league ?? null,
      result_trace: `oneshot-${Math.random().toString(36).slice(2, 9)}`,
    };

    // (Opcional) si tienes un formateador:
    try {
      if (typeof buildOneShot === 'function') {
        // no se publica aquí, sólo generamos el objeto listo
        Object.assign(payload, buildOneShot({ evt, match, enriched }));
      }
    } catch (_) {}

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: e?.message || String(e) }),
    };
  }
};
