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
    const league = q.league || 'La Liga';
    const sport = guessSportKeyFromLeague(league);
    const regions = process.env.ODDS_REGIONS || 'eu,uk,us,au';
    const markets = process.env.ODDS_MARKETS || 'h2h,both_teams_to_score,totals,double_chance';
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
sport, hasKey: !!process.env.ODDS_API_KEY, error: 'missing_key_or_sport' })};
    }

    const evURL = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events?apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`;
    const events = await _get(evURL);
    if (!Array.isArray(events) || events.length === 0) {
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
sport, events_len: 0, reason: 'no_events' })};
    }

    // Recorrer hasta encontrar 1 con markets:
    let tested = 0, found = null, sample = null;
    for (const ev of events) {
      tested++;
      const u = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(ev.id)}/odds?regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=iso&apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`;
      const raw = await _get(u);
      const node = Array.isArray(raw) ? raw[0] : raw;
      const b0 = node?.bookmakers?.[0];
      const m0 = b0?.markets || [];
      if (m0.length > 0) {
        found = ev;
        sample = { bookmaker: b0?.title || b0?.key, markets: m0.map(m => m?.key) };
        break;
      }
    }

    return { statusCode: 200, headers:{'content-type':'application/json'},
      body: JSON.stringify({
        send_report: (() => {
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
sport,
        events_len: events.length,
        tested,
        found_event: found ? { id: found.id, commence_time: found.commence_time, home: found.home_team, away: found.away_team } : null,
        sample
      })
    };
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
