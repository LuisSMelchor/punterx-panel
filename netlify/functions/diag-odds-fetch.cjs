// netlify/functions/diag-odds-fetch.cjs
'use strict';
const { fetchOddsEvents } = require('./_lib/fetch-odds.cjs');

const ok = (o) => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const err = (o) => ({ statusCode: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  const now = new Date();
  const q = event?.queryStringParameters || {};
  const debug = q.debug === '1';

  const res = await fetchOddsEvents({ now });
  if (debug) {
    // devolver también primeros N eventos para inspección manual
    const sample = res.events.slice(0, Number(q.max || 3)).map(e => ({
      ts: e.tsISO, league: e.league, home: e.home, away: e.away,
      markets: Object.keys(e.markets)
    }));
    return ok({ ok: res.ok, count: res.count, sample });
  }
  return res.ok ? ok({ ok: true, count: res.count }) : err({ ok: false, reason: res.reason });
};
