const enrich = require('./_lib/enrich.cjs');
const oneShot = enrich.oneShotPayload || enrich.buildOneShotPayload;

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now()+60*60*1000).toISOString()
    };
    const match = {}; // diagnóstico simple
    const fixture = { kickoff: evt.commence, league_name: evt.league };

    const payload = await oneShot({ evt, match, fixture });
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
error: e?.message || String(e) }) };
  }
};
