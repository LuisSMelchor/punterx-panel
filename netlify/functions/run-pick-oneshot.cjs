'use strict';

// === normalizeFinal: guard único, no reinsertar este bloque ===
if (!global.normalizeFinal) {
  global.normalizeFinal = function (x) {
    try {
      var y = x || {};
      var pld = (y && y.payload) ? y.payload : y;
      var ai  = (pld && pld.ai_json) ? pld.ai_json : null;
      if (ai){
        var pick = ai.ap_sugerida || {}, parts = ["✅ Sugerencia AI"];
        if (pick.mercado) parts.push("Mercado: "+pick.mercado);
        if (pick.pick)    parts.push("Selección: "+pick.pick);
        if (pick.cuota!=null) parts.push("Cuota: "+pick.cuota);
        if (typeof ai.probabilidad === "number") parts.push("Prob.: "+(ai.probabilidad*100).toFixed(1)+"%");
        if (typeof ai.ev_estimado   === "number") parts.push("EV: "+(ai.ev_estimado*100).toFixed(1)+"%");
        if (ai.resumen) parts.push("Notas: "+ai.resumen);
        var msg = parts.join("\n");
        pld.messages = { free: msg, vip: msg };
        y.meta = Object.assign({}, y.meta||{}, {
          ai_ok: !!(y.meta && y.meta.ai_ok),
          resolved: !!(y.meta && y.meta.resolved),
          will_send: !!(y.meta && y.meta.will_send)
        });
      }
      return y;
    } catch(e){ return x; }
  };
}
// === Minimal stable handler (S1.1 baseline): parse único + tail safe ===
const { oneShotPayload, composeOneShotPrompt, ensureMarketsWithOddsAPI } = require('./_lib/enrich.cjs');
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');
const { callOpenAIOnce } = require('./_lib/ai.cjs');
/** Handler S2: parse → resolver → enrich → openai → normalizeFinal */
exports.handler = async function(event) {
  // ---- BODY PARSE (único punto de entrada) ----
  let bodyObj = {};
  try {
    if (event && typeof event.body === 'string' && event.body.trim().length) {
      bodyObj = JSON.parse(event.body);
    } else if (event && typeof event.body === 'object' && event.body) {
      bodyObj = event.body;
    }
  } catch (e) {
    bodyObj = { reason: 'invalid-json' };
  }
  // Exponer mínimos (sin redeclarar globals)
  try {
    if (typeof evt === 'undefined') { global.evt = bodyObj.evt || {}; } else { evt = bodyObj.evt || evt || {}; }
    if (typeof ai_json === 'undefined') { global.ai_json = bodyObj.ai_json || {}; } else { ai_json = (bodyObj.ai_json ?? ai_json) || {}; }
  } catch (e) {}

  // === S2.1 Resolver (no fatal si falla) ===
  let match = null, fixture = null;
  try {
    match = await resolveTeamsAndLeague(global.evt || {}, {});
    fixture = {
      fixture_id: match?.fixture_id || null,
      kickoff: global.evt?.commence,
      league_id: match?.league_id || null,
      league_name: match?.league_name || global.evt?.league || null,
      country: match?.country || null,
      home_id: match?.home_id || null,
      away_id: match?.away_id || null,
    };
  } catch (e) { console.warn('[resolver.fail]', e?.message || e); }
  // === S2.2 Payload base ===
  let payload = {};
  try {
    payload = await oneShotPayload({ evt: global.evt || {}, match, fixture }) || {};
  } catch (e) {
    console.warn('[payload.fail]', e?.message || e);
    payload = {};
  }
  payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

  // === S2.3 Enrich (opt-in por ENV) ===
try {
  if (String(process.env.ODDS_ENRICH_ONESHOT) === '1') {
    payload = payload || {};
    const __before = Object.keys(payload?.markets||{}).length;
    payload.meta = { ...(payload.meta||{}), enrich_attempt: 'oddsapi:events' };

    const res = await ensureMarketsWithOddsAPI(payload, global.evt || {});
    // merge res -> payload
    try {
      if (payload && res && res.markets && typeof res.markets === "object") {
        payload.markets = Object.assign({}, payload.markets||{}, res.markets);
      } else if (payload && res && typeof res === "object") {
        payload = Object.assign({}, payload, res);
      }
    } catch(_){}

    // delta/status
    const __after = Object.keys(payload?.markets||{}).length;
    const __added = Math.max(0, __after - __before);
        if (Number(process.env.DEBUG_TRACE) === 1) {         try { console.log("[ENRICH.delta]", {before: __before, after: __after, added: __added}); } catch(_){ } }
    payload.meta = { ...(payload.meta||{}),
      enrich_status: (__after>0 ? 'ok' : 'error'),
      enrich_info: Object.assign(
        { before: __before, after: __after, added: __added, source: 'oddsapi:ensure' },
        payload.meta?.enrich_info || {}
      )
    };
      // [AUTO-CLEAN.enrich_error.after] si quedó ok, borra enrich_error
      try { if (payload?.meta?.enrich_status === 'ok') delete payload.meta.enrich_error; } catch(_){ }
      if (Number(process.env.DEBUG_TRACE) === 1) {       try { console.log("[ENRICH.status]", { before: __before, after: __after, added: __added, status: payload?.meta?.enrich_status }); } catch(_){ } }
    try { if (payload?.meta?.enrich_status === 'ok' && payload.meta.enrich_error) delete payload.meta.enrich_error; } catch(_){}

  } else {
    payload = payload || {};
    payload.meta = { ...(payload.meta||{}), enrich_attempt: 'skipped' };
  }
} catch (e) {
  console.warn('[enrich.fail]', e?.message || e);
  try {
    const s = e && (e.status || e.code || e.response?.status);
    const d = e && (e.response?.data || e.data || e.message || String(e));
    console.log("[ENRICH.ERROR.detail]", { status:s, data: (typeof d==="object"? JSON.stringify(d).slice(0,400): d) });
  } catch(_){}
  if (Number(process.env.DEBUG_TRACE) === 1) {
    try { console.log("[ENRICH.ERROR.stack]", (e && e.stack) || "(no stack)"); } catch(_){}
    try { console.log("[ENRICH.ERROR.payload.keys]", Object.keys(payload||{})); } catch(_){}
  }
  payload = payload || {};
  payload.meta = { ...(payload.meta||{}), enrich_status: 'error' };
}
// === S2.4 OpenAI (una vez) — opcional ===
  // === S2.4 OpenAI (una vez) — opcional ===
  try {
    const prompt = composeOneShotPrompt(payload);
    const ai = await callOpenAIOnce({ prompt });
    if (ai?.ok && ai?.data && typeof ai.data === 'object') {
      payload.ai_json = payload.ai_json || {};
      Object.assign(payload.ai_json, ai.data);
    }
  } catch (e) { console.warn('[openai.fail]', e?.message || e); }
  // === S2.5 Respuesta final (normalizeFinal arma messages si hay ai_json) ===
    // [AUTO-INJECT pre-response clean] si quedó ok, borra enrich_error
        try {
          if (payload?.meta?.enrich_error && /payload is not defined/i.test(String(payload.meta.enrich_error))) {
            delete payload.meta.enrich_error;
          }
        } catch(_){ }
  let resp = {
    ok: true,
    payload,
    meta: { ...(payload.meta||{}), ai_ok: !!(payload.ai_json && Object.keys(payload.ai_json||{}).length) }
  };

  try {
    if (typeof global.normalizeFinal === 'function') {
      resp = global.normalizeFinal(resp) || resp;
    }
  } catch (e) {}

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(resp)
  };
};
