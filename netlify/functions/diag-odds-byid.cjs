'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const https = require('https');
const { guessSportKeyFromLeague } = require('./_lib/odds-helpers.cjs');

function _get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: 10000 }, (res) => {
      let data=''; res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e){ reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const league = q.league || 'MLS';
    const eventId = q.id;
    if (!eventId) {
      return { statusCode: 400, headers:{'content-type':'application/json'}, const __send_report = (() => {
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
      body: JSON.stringify({ send_report: __send_report, error: 'missing id'})};
    }
    const sport = guessSportKeyFromLeague(league);
    if (!process.env.ODDS_API_KEY || !sport) {
      return { statusCode: 200, headers:{'content-type':'application/json'}, body: JSON.stringify({ send_report: (() => {
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
sport, hasKey: !!process.env.ODDS_API_KEY, fetch_len: 0 })};
    }
    const regions = process.env.ODDS_REGIONS || 'eu,uk,us,au';
    const markets = process.env.ODDS_MARKETS || 'h2h,both_teams_to_score,totals,double_chance';
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=iso`;
    const arr = await _get(url);
    const out = Array.isArray(arr) ? arr : (arr ? [arr] : []);
    let marketsPeek = [];
    if (out[0]?.bookmakers?.[0]?.markets) {
      marketsPeek = out[0].bookmakers[0].markets.map(m => m?.key);
    }
    return { statusCode: 200, headers:{'content-type':'application/json'},
      body: JSON.stringify({ send_report: (() => {
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
sport, fetch_len: out.length, marketsPeek, sampleTeams: { home: out[0]?.home_team, away: out[0]?.away_team }  }, null, 2),};
  } catch (e) {
    return { statusCode: 500, headers:{'content-type':'application/json'}, body: JSON.stringify({ send_report: (() => {
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
