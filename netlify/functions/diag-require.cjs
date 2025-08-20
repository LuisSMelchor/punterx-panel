'use strict';

// NO imports arriba. Todo dentro del handler:
exports.handler = async (event) => {
  const debug = (event?.headers?.['x-debug'] === '1' || event?.queryStringParameters?.debug === '1');

  function tryRequire(label, p) {
    try {
      require(p);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e), stack: debug ? (e?.stack || null) : undefined };
    }
  }

  // Lista de módulos locales típicos del proyecto
  const targets = [
    ['_logger', './_logger.cjs'],
    ['_diag_core', './_diag-core-v4.cjs'],
    ['_supabase_client', './_supabase-client.cjs'],
    ['_telemetry', './_telemetry.cjs'],
    ['_users', './_users.cjs'],
    ['af_resolver', './_lib/af-resolver.cjs'],
    ['corazonada', './_corazonada.cjs'],
    // Agrega otros locales si existen
  ];

  const results = {};
  for (const [label, p] of targets) {
    results[label] = tryRequire(label, p);
  }

  // También probamos require('openai') y '@supabase/supabase-js'
  function tryPkg(label, name) {
    try {
      require(name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e), stack: debug ? (e?.stack || null) : undefined };
    }
  }
  results.pkg_openai = tryPkg('openai', 'openai');
  results.pkg_supabase = tryPkg('supabase', '@supabase/supabase-js');

  // Env mínimos
  const requiredEnv = [
    'SUPABASE_URL','SUPABASE_KEY','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID','ODDS_API_KEY','API_FOOTBALL_KEY','AUTH_CODE'
  ];
  const envMissing = requiredEnv.filter(k => !(process.env[k] && String(process.env[k]).trim().length));

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      env_missing: envMissing,
      requires: results
    })
  };
};
