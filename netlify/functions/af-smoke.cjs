'use strict';
const { resolveTeamsAndLeague } = require('./_lib/resolver-af.cjs');

exports.handler = async (event) => {
  const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!console  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && typeof message_free !== "undefined" && message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
try {
    // __PARSE_BODY_SANITY__ (parseo único del body)
    const isJson = (event.headers && /application\/json/i.test(String(event.headers["content-type"] || event.headers["Content-Type"] || "")));
    let body = {}; try { if (event.body && isJson) body = JSON.parse(event.body); } catch(_){ /* no-op */ }
    const q0 = new URLSearchParams(event.queryStringParameters || {});
    const cmd = String(q0.get("cmd") || body.cmd || "").trim();
    const date = String(q0.get("date") || body.date || "").trim();
    if (cmd === "fixturesByDate" && date) {
      const apiKey = process.env.API_FOOTBALL_KEY;
      if (!apiKey) {
        return { statusCode: 500, body: JSON.stringify({ send_report: __send_report, error: "API-Football key missing" }) };
      }
      const url = `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(date)}`;
      const resp = await fetch(url, { headers: { "x-apisports-key": apiKey } });
      const data = await resp.json().catch(() => ({ response: [] }));
      const response = (data && data.response) ? data.response : [];
      return { statusCode: 200, body: JSON.stringify({ send_report: __send_report, date, response }, null, 2) };
    }
      // __RESOLVE_EVT__ (oneshot por body/query)
      if (cmd === "resolveEvt") {
        const home = String((body.home ?? "") || (q0.get("home") ?? "")).trim();
        const away = String((body.away ?? "") || (q0.get("away") ?? "")).trim();
        const league = String((body.league ?? body.liga ?? "") || (q0.get("league") ?? q0.get("liga") ?? "")).trim();
        const commence = String((body.commence ?? "") || (q0.get("commence") ?? "")).trim();
        const evt = { home, away, league_hint: league, when_text: commence };
        const r = await resolveTeamsAndLeague(evt, { verbose: Number(process.env.AF_VERBOSE ?? 0) });
        return { statusCode: 200, body: JSON.stringify({ send_report: __send_report, evt, result: r }, null, 2) };
      }
    const q = new URLSearchParams(event.queryStringParameters || {});
    const home = q.get('home') || '';
    const away = q.get('away') || '';
    const liga = q.get('liga') || q.get('league') || '';
    const commence = q.get('commence') || null;

    const evt = { home, away, league_hint: liga, when_text: commence };
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
