'use strict';
const { createRequire } = require('module');
const req = createRequire(__filename);

// Nota: no reimportar autopick-vip-run2.cjs (evita ciclo).
module.exports.call = async function call(opts = {}) {
  const { loadWindowNdjson, parseNdjsonToArray } =
    await import('../netlify/functions/_lib/snapshot-loader.mjs');

  let [mktTxt, betsTxt] = await Promise.all([
    loadWindowNdjson('mkt'),
    loadWindowNdjson('bets'),
  ]);

  // Fallback directo a EV_*_URL por si el loader regresara vacío
  if ((!mktTxt || !mktTxt.length) && process.env.EV_MKT_URL)  {
    const { loadNdjson } = await import('../netlify/functions/_lib/snapshot-loader.mjs');
    mktTxt = await loadNdjson(process.env.EV_MKT_URL);
  }
  if ((!betsTxt || !betsTxt.length) && process.env.EV_BETS_URL) {
    const { loadNdjson } = await import('../netlify/functions/_lib/snapshot-loader.mjs');
    betsTxt = await loadNdjson(process.env.EV_BETS_URL);
  }

  const mkt  = parseNdjsonToArray(mktTxt);
  const bets = parseNdjsonToArray(betsTxt);

  return {
    ok: true,
    stage: 'shim.call',
    counts: { mkt: Array.isArray(mkt)?mkt.length:0, bets: Array.isArray(bets)?bets.length:0 },
    picks: [],
    meta: { winMin: Number(process.env.WIN_MIN||40), winMax: Number(process.env.WIN_MAX||55) }
  };
};

// Handler estilo Netlify que delega en call() y empaqueta respuesta HTTP
module.exports.handler = async function handler(event, context) {
  try {
    const res = await module.exports.call({ event, context, manual: true });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok:true, stage:'shim.handler', data: res })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok:false, stage:'shim.handler', error: String(e && (e.message||e)) })
    };
  }
};
