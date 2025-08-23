'use strict';

// Wrapper estable que llama a la implementación real y siempre devuelve JSON en caso de error
exports.handler = async (event, context) => {
  try {
    const mod = require('./autopick-vip-nuevo-impl.cjs');
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
