// netlify/functions/diagnostico-total.js
// Endpoint HTTP del diagnóstico (no programado; URL pública)
// (Versión corregida: evita colisiones de identificadores con _diag-core.cjs)

// Polyfill fetch por si el runtime frío no lo trae aún
try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

const { runChecks, renderHTML } = require('./_diag-core.cjs');

// Nombres únicos para evitar choque con símbolos del bundle
const __nowISO = () => new Date().toISOString();
const __wantsJSON = (e) => !!((e.queryStringParameters || {}).json);
const __wantsPing = (e) => !!((e.queryStringParameters || {}).ping);

exports.handler = async (event) => {
  try {
    if (__wantsPing(event)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, ping: 'pong', at: __nowISO() })
      };
    }

    const payload = await runChecks();

    if (__wantsJSON(event)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: renderHTML(payload)
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
