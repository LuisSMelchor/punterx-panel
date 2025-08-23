'use strict';

// Wrapper para diagnosticar crash al cargar o ejecutar autopick-vip-nuevo.
exports.handler = async (event, context) => {
  try {
    const mod = require('./autopick-vip-nuevo.cjs');
    if (!mod || typeof mod.handler !== 'function') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok:false, stage:'wrapper', error:'handler no encontrado' })
      };
    }
    return await mod.handler(event, context);
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        stage: 'require_or_boot',
        error: String((e && (e.message || e)) || e),
        stack: e && e.stack ? String(e.stack) : null
      })
    };
  }
};
