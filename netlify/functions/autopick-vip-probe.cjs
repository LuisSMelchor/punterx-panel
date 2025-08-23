'use strict';

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const out = { ok: true, requires: {}, note: 'probe loads same deps as autopick-vip-nuevo (top-level)' };

  // Lista de require() en el MISMO orden general que usa autopick-vip-nuevo
  const tests = [
    ['fs',           () => require('fs')],
    ['path',         () => require('path')],
    ['_logger',      () => require('./_lib/_logger.cjs')],
    ['af_resolver',  () => require('./_lib/af-resolver.cjs')],
    ['corazonada',   () => require('./_lib/_corazonada.cjs')],
    ['match_helper', () => require('./_lib/match-helper.cjs')],
  ];

  for (const [name, fn] of tests) {
    try { fn(); out.requires[name] = { ok: true }; }
    catch (e) {
      out.ok = false;
      out.requires[name] = { ok: false, err: String(e && (e.message || e)) };
      // si piden stop al primer error: ?stop=1
      if (q.stop === '1') break;
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(out)
  };
};
