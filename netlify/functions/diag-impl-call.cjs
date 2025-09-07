// netlify/functions/diag-impl-call.cjs
// PunterX · Diagnóstico de delegadores/impl — guardrails: inspect=200, bypass=403
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const qbool = (v) => v === '1' || v === 'true' || v === 'yes';

// Sentinela para validar único parseo de body
const __PARSE_BODY_SANITY__ = true;

exports.handler = async (event) => {
  // --- Parseo único de body (blindado, sin helpers externos) ---
  let body = null;
  try {
    if (event && event.body) {
      body = JSON.parse(event.body);
    }
  } catch (_e) {
    // no-op; no imprimimos payloads
  }

  // --- Query/headers normalizados ---
  const qs = (event && event.queryStringParameters) || {};
  const headers = {};
  try {
    const raw = (event && event.headers) || {};
    for (const k in raw) {
      const v = raw[k];
      headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
  } catch (_e) {}

  const debug = qbool(qs.debug) || headers['x-debug'] === '1';

  // --- Guardrails ---
  if (qbool(qs.inspect)) {
    if (debug) console.log('[AF_DEBUG] diag-impl-call inspect=1 → 200');
    return __json(200, { ok: true, inspect: 1, __PARSE_BODY_SANITY__ });
  }

  if (qbool(qs.bypass)) {
    if (debug) console.log('[AF_DEBUG] diag-impl-call bypass=1 → 403');
    return __json(403, { ok: false, error: 'forbidden' });
  }

  // Default: ping breve
  if (qbool(qs.ping)) {
    return __json(200, { ok: true, ping: 'diag-impl-call (pong)' });
  }

  return __json(200, { ok: true, msg: 'diag-impl-call ready' });
};
