'use strict';
const { guessSportKeyFromLeague } = require('./_lib/odds-helpers.cjs');
const https = require('https');

function _get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!null  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!null && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
try {
    const q = event?.queryStringParameters || {};
    const league = (q.league || "").trim();
    const home = (q.home || "").trim();
    const away = (q.away || "").trim();
    const kickoff = (q.commence || "").trim();

    const sport = (q.sport && String(q.sport).trim()) || guessSportKeyFromLeague(league);
    if (process.env.LOG_VERBOSE === "1") console.log("[AF_DEBUG] diag-odds-events sport=", sport);
    if (!process.env.ODDS_API_KEY || !sport) {
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send_report: __send_report,
sport, hasKey: !!process.env.ODDS_API_KEY, events_len: 0, sample: null })};
    }

    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}&dateFormat=iso`;
    const arr = await _get(url);
      if (String(q.raw||"")==="1") {
        const out = Array.isArray(arr) ? arr : [];
        return { statusCode:200, headers:{"content-type":"application/json"}, body: JSON.stringify(out) };
      }
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      send_report: __send_report,
sport, hasKey: !!process.env.ODDS_API_KEY,
      events_len: Array.isArray(arr) ? arr.length : 0,
      first: Array.isArray(arr) ? arr.slice(0,3) : null
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send_report: __send_report,
error: e?.message || String(e) }) };
  }
};
