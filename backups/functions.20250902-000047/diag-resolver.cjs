const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
exports.handler = async () => {
  const __send_report = (() => {
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
})();
const { AF_DEBUG=0, AF_METRICS=0, MATCH_RESOLVE_CONFIDENCE=0.80, SIM_THR=0.60, TIME_PAD_MIN=90 } = process.env;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      send_report: __send_report,
name: 'diag-resolver',
      ok: true,
      env: {
        AF_DEBUG: Number(AF_DEBUG),
        AF_METRICS: Number(AF_METRICS),
        MATCH_RESOLVE_CONFIDENCE: Number(MATCH_RESOLVE_CONFIDENCE),
        SIM_THR: Number(SIM_THR),
        TIME_PAD_MIN: Number(TIME_PAD_MIN),
      },
      ts: new Date().toISOString(),
    })
  };
};
