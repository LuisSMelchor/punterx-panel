// netlify/functions/diagnostico-total.js
// Endpoint HTTP del diagnóstico (URL pública) — UI pro + actividad de picks (deep)

try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

const { runChecks, runDeepActivity, renderHTML } = require('./_diag-core.cjs');

// Identificadores únicos (evita colisiones en bundle)
const __nowISO = () => new Date().toISOString();
const __wantsJSON = (e) => !!((e.queryStringParameters || {}).json);
const __wantsPing = (e) => !!((e.queryStringParameters || {}).ping);
const __wantsDeep = (e) => !!((e.queryStringParameters || {}).deep);
const __num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

exports.handler = async (event) => {
  try {
    if (__wantsPing(event)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, ping: 'pong', at: __nowISO() })
      };
    }

    const base = await runChecks();

    // Deep mode: consultas a Supabase para actividad de picks
    if (__wantsDeep(event)) {
      const qs = event.queryStringParameters || {};
      const limit = __num(qs.limit, 30);
      const hours = __num(qs.hours, 24);
      const activity = await runDeepActivity({ limit, hours });
      base.activity = {
        ok: activity.ok,
        limit,
        window_hours: hours,
        took_ms: activity.took_ms,
        ...(activity.ok ? { rows: activity.rows, metrics: activity.metrics } : { error: activity.error })
      };
    }

    if (__wantsJSON(event)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(base)
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: renderHTML(base)
    };
  } catch (e) {
    const body = { ok: false, error: e?.message || String(e), at: __nowISO() };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
  }
};
