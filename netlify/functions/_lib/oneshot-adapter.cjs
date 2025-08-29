'use strict';
const enrich = require('./enrich.cjs');

// Helper seguro para elegir la primera función disponible de una lista
function pick(fnNames=[], mod=enrich) {
  for (const k of fnNames) {
    if (k && typeof mod[k] === 'function') return mod[k].bind(mod);
  }
  return null;
}

// 1) oneShotPayload: intenta varias convenciones; si no hay, arma un payload mínimo
const _oneShotPayload =
  pick(['oneShotPayload', 'buildOneShotPayload', 'makeOneShotPayload', 'payloadOneShot'], enrich) ||
  (async function fallbackOneShotPayload({ evt={}, match=null, fixture=null }) {
    // Payload mínimo coherente con nuestros guardrails
    return {
      match,
      fixture,
      enriched: { league: fixture?.league_name || evt?.league || null, kickoff: fixture?.kickoff || evt?.commence || null },
      markets_top3: []  // vacío si aún no hay cuotas
    };
  });

// 2) composeOneShotPrompt: intenta varias; si no hay, construye prompt JSON-first
const _composeOneShotPrompt =
  pick(['composeOneShotPrompt', 'buildOneShotPrompt', 'makeOneShotPrompt', 'promptOneShot'], enrich) ||
  function fallbackComposeOneShotPrompt(payload) {
    const hint = {
      instrucciones: "Devuelve exclusivamente un JSON válido. Campos: apuesta_sugerida{mercado,seleccion,cuota}, probabilidad_estim (0-100), apuestas_extra[]. Nada de texto adicional.",
      contexto_min: {
        league: payload?.enriched?.league || null,
        kickoff: payload?.enriched?.kickoff || null,
        has_markets: Array.isArray(payload?.markets_top3) && payload.markets_top3.length>0
      }
    };
    return JSON.stringify(hint);
  };

async function oneShotPayload(args) { return _oneShotPayload(args); }
function composeOneShotPrompt(payload) { return _composeOneShotPrompt(payload); }

module.exports = { oneShotPayload, composeOneShotPrompt };
