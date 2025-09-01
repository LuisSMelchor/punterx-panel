'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
exports.handler = async () => {
  const out = { ok: true, requires: {} };
  function check(name, fn) {
    try { fn(); out.requires[name] = { ok: true }; }
    catch (e) { out.ok = false; out.requires[name] = { ok: false, error: String(e.message || e) }; }
  }

  // Requiere LOCALES (estáticos para que esbuild los detecte)
  check('_logger',           () => require('./_lib/_logger.cjs'));
  check('_diag_core',        () => require('./_lib/_diag-core-v4.cjs'));
  check('_supabase_client',  () => require('./_lib/_supabase-client.cjs'));
  check('_telemetry',        () => require('./_lib/_telemetry.cjs'));
  check('_users',            () => require('./_lib/_users.cjs'));
  check('corazonada',        () => require('./_lib/_corazonada.cjs'));
  check('af_resolver',       () => require('./_lib/af-resolver.cjs'));

  // Paquetes externos
  check('pkg_openai',   () => require('openai'));
  check('pkg_supabase', () => require('@supabase/supabase-js'));
  check('pkg_fetch', async () => {
  if (typeof fetch !== 'function') {
    const mod = await import('node-fetch');
    globalThis.fetch = mod.default || mod;
  }
  return true;
});

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(out)
  };
};
