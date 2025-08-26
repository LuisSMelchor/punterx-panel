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
  try {
    const q = event?.queryStringParameters || {};
    const league = q.league || 'Major League Soccer';
    const home = q.home || 'Charlotte FC';
    const away = q.away || 'New York Red Bulls';
    const kickoff = q.commence || new Date(Date.now()+6*60*60*1000).toISOString();

    const sport = guessSportKeyFromLeague(league);
    if (!process.env.ODDS_API_KEY || !sport) {
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sport, hasKey: !!process.env.ODDS_API_KEY, events_len: 0, sample: null })};
    }

    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}&dateFormat=iso`;
    const arr = await _get(url);
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sport, hasKey: !!process.env.ODDS_API_KEY,
      events_len: Array.isArray(arr) ? arr.length : 0,
      first: Array.isArray(arr) ? arr.slice(0,3) : null
    }, null, 2) };
  } catch (e) {
    return { statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
