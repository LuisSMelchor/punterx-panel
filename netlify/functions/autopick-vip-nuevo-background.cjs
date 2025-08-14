// --- BLINDAJE RUNTIME: fetch + trampas globales (añadir al inicio del archivo) ---
try {
  if (typeof fetch === 'undefined') {
    // Polyfill para runtimes/lambdas donde fetch aún no está disponible
    global.fetch = require('node-fetch');
  }
} catch (_) { /* no-op */ }

try {
  // Evita “Internal Error” si algo revienta antes del handler
  process.on('uncaughtException', (e) => {
    try { console.error('[UNCAUGHT]', e && (e.stack || e.message || e)); } catch {}
  });
  process.on('unhandledRejection', (e) => {
    try { console.error('[UNHANDLED]', e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) { /* no-op */ }
// --- FIN BLINDAJE RUNTIME ---

'use strict';

/**
 * Reutiliza la lógica existente de autopick-vip-nuevo (sin duplicarla).
 * Netlify, al detectar el sufijo -background, devuelve 202 de inmediato al cliente
 * y la ejecución continúa en segundo plano sin bloquear.
 */

const main = require('./autopick-vip-nuevo.cjs');

exports.handler = async (event, context) => {
  const started = Date.now();
  console.log('[BG] autopick-vip-nuevo-background: start');

  try {
    // Reutilizamos la misma función principal.
    await main.handler(event, context);
  } catch (e) {
    console.error('[BG] error:', e?.message || e);
  } finally {
    console.log('[BG] done in', Date.now() - started, 'ms');
  }

  // En background, Netlify responde 202 automáticamente; devolvemos algo por claridad local.
  return { statusCode: 202, body: 'accepted' };
};
