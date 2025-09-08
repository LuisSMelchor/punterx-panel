'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');

exports.handler = async (event, context) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
  try {
    const q = (event && event.queryStringParameters) || {};
    if (q.ping === '1') return { statusCode: 200, body: 'pong' };

    const body = event.body ? JSON.parse(event.body) : {};
    const evt = body.evt || {};

    const enriched = await ensureMarketsWithOddsAPI({ evt });

    return { statusCode: 200, body: JSON.stringify({ send_report: __send_report, enriched }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ send_report: __send_report, error: e?.message || String(e) }) };
  }
};
