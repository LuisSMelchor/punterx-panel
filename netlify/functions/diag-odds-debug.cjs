'use strict';
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
      body: JSON.stringify({
        input: evt,
        env: {
          ODDS_REGIONS: regions,
          ODDS_MARKETS: marketsRq,
          has_ODDS_API_KEY: !!process.env.ODDS_API_KEY
        },
        sportKeyFromMap,
        fetch_len: count,
        marketsPeek,
        sampleTeams: sample ? { home: sample.home_team, away: sample.away_team, commence_time: sample.commence_time } : null
      }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
