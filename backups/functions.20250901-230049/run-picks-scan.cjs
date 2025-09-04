'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./_lib/enrich.cjs');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Reusamos tu batch adentro (llamándolo en memoria)
const batch = require('./run-picks-batch.cjs');

const ODDS_BASE = process.env.ODDS_BASE || 'https://api.the-odds-api.com/v4';
const API_KEY   = process.env.ODDS_API_KEY || '';
const TTL_MS    = Number(process.env.ODDS_SCAN_TTL_MS || 600000); // 10 min
const CACHE_DIR = path.join(process.cwd(), '.netlify', 'cache', 'oddsapi');

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch(_){} }
function nowMs() { return Date.now(); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(_){ return null; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data), 'utf8'); } catch(_){}
}

function cachePathFor(sport, daysAhead) {
  const dayKey = new Date().toISOString().slice(0,10); // YYYY-MM-DD (hoy)
  return path.join(CACHE_DIR, `events_${sport}_${dayKey}_d${daysAhead}.json`);
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function listEventsForSport(sport, daysAhead) {
  ensureDir(CACHE_DIR);
  const file = cachePathFor(sport, daysAhead);
  try {
    const st = fs.statSync(file);
    if ((nowMs() - st.mtimeMs) < TTL_MS) {
      const cached = readJson(file);
      if (cached) return cached;
    }
  } catch(_){}

  const url = new URL(`${ODDS_BASE}/sports/${sport}/events`);
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('daysFrom', '0');
  url.searchParams.set('daysTo', String(daysAhead));

  const data = await fetchJson(url.toString());
  writeJson(file, data);
  return data;
}

function normalizeEvents(rawList = []) {
  return rawList.map(ev => ({
    home:     ev?.home_team || ev?.teams?.[0] || null,
    away:     ev?.away_team || ev?.teams?.[1] || null,
    league:   ev?.sport_title || ev?.league || null,
    commence: ev?.commence_time || ev?.commence || null
  })).filter(x => x.home && x.away && x.commence);
}

function demoEvents() {
  return [
    {home:"Liverpool",  away:"Chelsea",   league:"Premier League", commence:"2025-08-16T16:30:00Z"},
    {home:"Arsenal",    away:"Man City",  league:"Premier League", commence:"2025-08-16T16:30:00Z"},
    {home:"Real Madrid",away:"Barcelona", league:"La Liga",        commence:"2025-09-01T19:00:00Z"},
    {home:"Inter",      away:"Juventus",  league:"Serie A",        commence:"2025-09-01T18:45:00Z"}
  ];
}

exports.handler = async (event) => {
  const __send_report = (() => { const en=(String(process.env.SEND_ENABLED)==='1'); const base={ enabled: en, results:(typeof send_report!=='undefined'&&send_report&&Array.isArray(send_report.results))?send_report.results:[] }; if(en&&typeof message_vip!=='undefined'&&message_vip&&!process.env.TG_VIP_CHAT_ID) base.missing_vip_id=true; if(en&&typeof message_free!=='undefined'&&message_free&&!process.env.TG_FREE_CHAT_ID) base.missing_free_id=true; return base; })();
try {
    const q = event?.queryStringParameters || {};
    const bodyIn = event?.body ? JSON.parse(event.body) : {};

    const sports = String(q.sports || bodyIn.sports || process.env.ODDS_SCAN_SPORTS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const daysAhead = Math.max(0, Number(q.days_ahead ?? bodyIn.days_ahead ?? process.env.ODDS_SCAN_DAYS_AHEAD ?? 2));
    const scanMax   = Math.max(1, Number(q.scan_max   ?? bodyIn.scan_max   ?? process.env.ODDS_SCAN_MAX       ?? 150));

    const min_h2x_len = Math.max(0, Number(q.min_h2x_len ?? bodyIn.min_h2x_len ?? 3));
    const require_markets = Array.isArray(bodyIn.require_markets)
      ? bodyIn.require_markets
      : (q.require_markets ? String(q.require_markets).split(',').map(s=>s.trim()) : ["1x2"]);
    const limit = Math.max(1, Number(q.limit ?? bodyIn.limit ?? 50));

    let allEvents = [];
    let usedMode = 'api';

    if (!API_KEY) {
      allEvents = demoEvents();
      usedMode = 'mock';
    } else {
      if (!sports.length) {
        return { statusCode: 400, headers:{'content-type':'application/json'},
          body: JSON.stringify({ ok:false, error:'ODDS_SCAN_SPORTS empty' }) };
      }
      for (const s of sports) {
        try {
          const raw = await listEventsForSport(s, daysAhead);
          const norm = normalizeEvents(raw);
          allEvents = allEvents.concat(norm);
        } catch (e) {
          allEvents.push({ error: String(e?.message || e), _sport: s });
        }
        await new Promise(r => setTimeout(r, 80));
      }
    }

    const events = allEvents
      .filter(e => e && e.home && e.away && e.commence)
      .slice(0, scanMax);

    const resp = await batch.handler({
      body: JSON.stringify({ events, limit, min_h2x_len, require_markets })
    });

    const out = {
      ok: true,
      mode: usedMode,
      sports,
      days_ahead: daysAhead,
      scan_max: scanMax,
      discovered: allEvents.length,
      considered: events.length,
      batch: resp && resp.body ? JSON.parse(resp.body) : null
    };

    return { statusCode: 200, headers:{'content-type':'application/json'}, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 500, headers:{'content-type':'application/json'},
      body: JSON.stringify({ ok:false, error: String(e?.message || e) }) };
  }
};
