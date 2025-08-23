'use strict';

// Wrapper para diagnosticar crash al cargar o ejecutar autopick-vip-nuevo.
// Si falla el require() (top-level) o el handler al arrancar, devolvemos JSON con el stack.

exports.handler = async (event, context) => {
  try {
    // Passthrough de headers/qs para que respete AUTH y ?debug=1&manual=1
    const mod = require('./autopick-vip-nuevo.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok:false, stage:'wrapper', error:'handler no encontrado' })
      };
    }
    // Llamada real
    return await mod.handler(event, context);
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        stage: 'require_or_boot',
        error: String(e && (e.message || e)),
        stack: e && e.stack ? String(e.stack) : null
      })
    };
  }
};
