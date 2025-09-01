'use strict';

const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const { fetchOddsForFixture, guessSportKeyFromLeague } = require('./_lib/odds-helpers.cjs');

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const evt = {
      home: q.home || 'Charlotte FC',
      away: q.away || 'New York Red Bulls',
      league: q.league || 'Major League Soccer',
      commence: q.commence || new Date(Date.now() + 6*60*60*1000).toISOString(), // +6h
    };

    const regions = process.env.ODDS_REGIONS || 'eu';
    const marketsRq = process.env.ODDS_MARKETS || 'h2h,both_teams_to_score,totals,double_chance';

    const sportKeyFromMap = guessSportKeyFromLeague(evt.league);
    let arr = await fetchOddsForFixture(evt);

    const count = Array.isArray(arr) ? arr.length : (arr ? 1 : 0);
    const sample = Array.isArray(arr) ? arr[0] : arr;

    // peek de mercados si hay
    let marketsPeek = [];
    if (sample && Array.isArray(sample.bookmakers)) {
      const m0 = sample.bookmakers[0];
      if (m0 && Array.isArray(m0.markets)) marketsPeek = m0.markets.map(m => m?.key);
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!(typeof (typeof message_vip!=='undefined'?message_vip:null)!=='undefined'?(typeof message_vip!=='undefined'?message_vip:null):null)  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!(typeof (typeof message_free!=='undefined'?message_free:null)!=='undefined'?(typeof message_free!=='undefined'?message_free:null):null) && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
      body: JSON.stringify({ send_report: __send_report, input: evt,
        env: {
          ODDS_REGIONS: regions,
          ODDS_MARKETS: marketsRq,
          has_ODDS_API_KEY: !!process.env.ODDS_API_KEY
        },
        sportKeyFromMap,
        fetch_len: count,
        marketsPeek,
        sampleTeams: sample ? { home: sample.home_team, away: sample.away_team, commence_time: sample.commence_time } : null
       }, null, 2),};
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!(typeof (typeof message_vip!=='undefined'?message_vip:null)!=='undefined'?(typeof message_vip!=='undefined'?message_vip:null):null)  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!(typeof (typeof message_free!=='undefined'?message_free:null)!=='undefined'?(typeof message_free!=='undefined'?message_free:null):null) && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
error: e?.message || String(e) }) };
  }
};
