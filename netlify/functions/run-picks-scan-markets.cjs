'use strict';

// deps base
const scan = require('./run-picks-scan.cjs');

// fetch helper (node-fetch si no existe global)
let __fetch = null;
try { const nf = require('node-fetch'); __fetch = nf.default || nf; } catch (e) { __fetch = (typeof fetch === 'function') ? fetch : null; }

// base URL del propio functions host (autodetect, sin depender de ODDS_BASE)
function __resolveFunctionsBase(event) {
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h['host'] || `localhost:${process.env.PORT || 4999}`;
  const proto = h['x-forwarded-proto'] || 'http';
  return `${proto}://${host}/.netlify/functions`;
}

// fetch a odds-bookmakers
async function __odds_enrich_fetch(baseUrl, evt) {
  try {
    if (!__fetch || !baseUrl || !evt) return null;
    const u = new URL(baseUrl + '/odds-bookmakers');
    u.searchParams.set('evt', JSON.stringify(evt));
    const r = await __fetch(u.toString());
    if (!r || !r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.bookmakers) ? j.bookmakers : null;
  } catch (_) { return null; }
}
// handler principal (CJS)
module.exports.handler = async (event, context) => {
  // 1) ejecuta el scan base
  const base = await scan.handler(event, context);
  let payload;
  try { payload = JSON.parse(base.body || '{}'); } catch { payload = {}; }

  // 2) resultados y enrich
  const results = (payload && payload.batch && Array.isArray(payload.batch.results)) ? payload.batch.results : [];
  const functionsBase = __resolveFunctionsBase(event);
  let sum_bm = 0;

  for (const it of results) {
    try {
      if (!it || !it.evt) continue;
      const bm = await __odds_enrich_fetch(functionsBase, it.evt);
      if (bm && bm.length) { it.bookmakers = bm; sum_bm += bm.length; }
    } catch (_) { /* noop */ }
  }

  payload.__bookmakers_after = results.filter(r => r && Array.isArray(r.bookmakers) && r.bookmakers.length).length;
  payload.__enrich_dbg = { functionsBase, results_len: results.length, sum_bm };

  // 3) return JSON seguro
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
};
