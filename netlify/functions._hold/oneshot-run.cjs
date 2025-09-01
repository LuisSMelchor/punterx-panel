'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');

exports.handler = async (event) => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const baseSendReport = {
    enabled,
    results: []
  };

  if (enabled && typeof message_vip !== 'undefined' && message_vip && !process.env.TG_VIP_CHAT_ID)  baseSendReport.missing_vip_id = true;
  if (enabled && typeof message_free !== 'undefined' && message_free && !process.env.TG_FREE_CHAT_ID) baseSendReport.missing_free_id = true;

  const __send_report = baseSendReport;

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
