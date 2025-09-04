const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const { handler: publish } = require('./oneshot-publish.cjs');

/**
 * Orquestador batch:
 * - ?fixtures=home1,away1,league1,iso1|home2,away2,league2,iso2|...
 * - Si no se pasa, usa un set mínimo demo.
 */
exports.handler = async (event) => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const baseSendReport = {
    enabled,
    results: []
  };

  if (enabled && typeof message_vip !== 'undefined' && message_vip && !process.env.TG_VIP_CHAT_ID)  baseSendReport.missing_vip_id = true;
  if (enabled && typeof message_free !== 'undefined' && message_free && !process.env.TG_FREE_CHAT_ID) baseSendReport.missing_free_id = true;

  const __send_report = baseSendReport;

  if (process.env.FEATURE_ONESHOT !== '1') {
    return { statusCode: 200, body: JSON.stringify({ send_report: __send_report, status: 'feature_off'  }) };
  }
  const q = event?.queryStringParameters || {};
  const items = [];

  if (q.fixtures) {
    for (const part of q.fixtures.split('|')) {
      const [home, away, league, commence] = part.split(',');
      items.push({ home, away, league, commence });
    }
  } else {
    // Demo mínima (ajústalo a tu "script maestro" real)
  }

  const results = [];
  for (const evt of items) {
    const subEvent = { queryStringParameters: evt };
    try {
      const resp = await publish(subEvent);
      const body = JSON.parse(resp.body || '{}');
      results.push({ evt, ...body });
    } catch (e) {
      results.push({ evt, error: e?.message || String(e) });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ send_report: __send_report, status: 'ok', count: results.length, results   }, null, 2),};
};
