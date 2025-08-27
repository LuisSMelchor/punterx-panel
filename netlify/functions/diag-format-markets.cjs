'use strict';
const { formatMarketsTop3 } = require('./_lib/format-markets.cjs');

exports.handler = async (event) => {
  try {
    const body = (()=>{ try { return JSON.parse(event?.body||'{}'); } catch { return {}; } })();
    const txt = formatMarketsTop3(body.markets_top3 || []);
    return { statusCode: 200, body: JSON.stringify({ ok:true, text: txt }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }
};
