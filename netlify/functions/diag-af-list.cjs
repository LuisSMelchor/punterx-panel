'use strict';
const fetch = global.fetch || require('node-fetch');

exports.handler = async (event) => {
  try {
    const qs = (event && event.queryStringParameters) || {};
    const team = String(qs.team || '').trim();          // id numérico (42 Arsenal, 541 Real, 451 Boca)
    const date = String(qs.date || '').slice(0,10);     // yyyy-mm-dd
    const pad  = Math.max(0, Number(qs.pad || process.env.AF_MATCH_PAD_DAYS || 4));
    const key  = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || process.env.APIFOOTBALL_KEY || '';

    if (!key)  return { statusCode: 500, body: 'API_FOOTBALL_KEY missing' };
    if (!team) return { statusCode: 400, body: 'team required' };
    if (!date) return { statusCode: 400, body: 'date required' };

    const base = new Date(date+'T00:00:00Z');
    const from = new Date(base); from.setUTCDate(from.getUTCDate()-pad);
    const to   = new Date(base); to.setUTCDate(to.getUTCDate()+pad);
    const day  = d => d.toISOString().slice(0,10);

    const url = new URL('https://v3.football.api-sports.io/fixtures');
    url.searchParams.set('team', String(team));
    url.searchParams.set('from', day(from));
    url.searchParams.set('to',   day(to));
    url.searchParams.set('timezone','UTC');

    const r = await fetch(url, { headers: { 'x-apisports-key': key }});
    const j = await r.json().catch(()=> ({}));
    const list = Array.isArray(j && j.response) ? j.response : [];

    const out = list.map(it => ({
      fixture_id: it?.fixture?.id || null,
      date:       (it?.fixture?.date || '').slice(0,10),
      home:       it?.teams?.home?.name || null,
      away:       it?.teams?.away?.name || null,
      league:     it?.league?.name || null,
      country:    it?.league?.country || null
    }));

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ query:{team, date, pad}, window:{from: day(from), to: day(to)}, count: out.length, fixtures: out }, null, 2)
    };
  } catch (e) {
    return { statusCode: 500, headers:{'content-type':'text/plain'}, body: String(e && e.stack || e) };
  }
};
