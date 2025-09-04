'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
exports.handler = async (event) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
const method = (event && event.httpMethod || '').toUpperCase();
  let body = null;
  if (method === 'POST' && event && event.body) {
    try { body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body; } catch (_) {}
  }
  return {
    statusCode: 200,
    headers: {'content-type':'application/json'},
    body: JSON.stringify({ ok:true, method, echo: body })
  };
};
