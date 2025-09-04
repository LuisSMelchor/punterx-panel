"use strict";
// diag-enrich: diagnóstico de matching AF con normalización de evt
const _norm = require("./_lib/normalize.cjs");
const lib   = require("./_lib/enrich.cjs");

function parseBody(event){
  try { return (event && event.body) ? JSON.parse(event.body) : {}; }
  catch(_){ return {}; }
}
exports.handler = async (event) => {
  const bodyIn = parseBody(event);
  const STRICT_MATCH = Number(bodyIn.STRICT_MATCH ?? process.env.STRICT_MATCH ?? 1);
  const AF_VERBOSE   = Number(bodyIn.AF_VERBOSE   ?? process.env.AF_VERBOSE   ?? 0);

  let evt = _norm.normalizeEvt(bodyIn.evt || {});
  const out = {
    name: "diag-enrich",
    ok: true,
    STRICT_MATCH,
    AF_VERBOSE,
    resolver: { used:false, has_fn:false },
    enriched: {}
  };
  try {
    const hasFn = !!(lib && typeof lib.resolveTeamsAndLeague === "function");
    out.resolver.has_fn = hasFn;
    if (hasFn){
      out.resolver.used = true;
      const r = await lib.resolveTeamsAndLeague(evt, { verbose: AF_VERBOSE });
      out.enriched = r || {};
    } else {
      out.enriched = { fixture_id:null, league:null, country:null, when_text:_norm.normalizeWhenText(evt.when_text||"") };
    }
  } catch(e){
    out.ok = false;
    out.error = String(e && e.message || e);
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(out)
  };
};
