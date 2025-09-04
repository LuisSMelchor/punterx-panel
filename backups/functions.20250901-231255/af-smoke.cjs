'use strict';
const { resolveTeamsAndLeague } = require('./_lib/af-resolver.cjs');

exports.handler = async (event) => {
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
try {
    const q = new URLSearchParams(event.queryStringParameters || {});
    const home = q.get('home') || '';
    const away = q.get('away') || '';
    const liga = q.get('liga') || q.get('league') || '';
    const commence = q.get('commence') || null;

    const evt = { home, away, liga, commence };
    const r = await resolveTeamsAndLeague(evt, {
      leagueHint: liga || undefined,
      commence: commence || undefined,
      windowPadMin: 0
    });

    return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
evt, result: r }, null, 2) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ send_report: __send_report,
error: e?.message || String(e) }) };
  }
};
