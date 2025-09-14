'use strict';
const { createRequire } = require('module');
const req = createRequire(__filename);

// ¡NO re-importar autopick-vip-run2.cjs! (evita ciclo)
// Cargamos utilidades necesarias y devolvemos un resultado estable.
module.exports.call = async function call(opts = {}) {
  const { loadWindowNdjson, parseNdjsonToArray } =
    await import('../netlify/functions/_lib/snapshot-loader.mjs');

  // Leer EV desde variables (loader ya maneja data:, http(s) y blobs)
  const [mktTxt, betsTxt] = await Promise.all([
    loadWindowNdjson('mkt'),
    loadWindowNdjson('bets'),
  ]);

  const mkt  = parseNdjsonToArray(mktTxt);
  const bets = parseNdjsonToArray(betsTxt);

  // Respuesta mínima segura (sin Telegram ni side-effects)
  return {
    ok: true,
    stage: 'shim.call',
    counts: { mkt: Array.isArray(mkt)?mkt.length:0, bets: Array.isArray(bets)?bets.length:0 },
    // deja espacio para picks reales después
    picks: [],
    meta: { winMin: Number(process.env.WIN_MIN||40), winMax: Number(process.env.WIN_MAX||55) }
  };
};
