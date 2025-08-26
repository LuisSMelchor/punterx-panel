'use strict';
const https = require('https');
/**
 * Stub de enriquecimiento con OddsAPI (one-shot).
 * No realiza requests; opera sobre `oddsRaw` ya provisto.
 * Normaliza:
 *  - top3 bookies por mercado (ordenado por cuota)
 *  - liga con país (si viene en `fixture`)
 *  - hora relativa "Comienza en X minutos aprox"
 */

function minutesUntil(iso) {
  const t = new Date(iso);
  if (Number.isNaN(+t)) return null;
  const diffMs = t - new Date();
  return Math.round(diffMs / 60000);
}

function pickTop3(offers = []) {
  // offers: [{bookmaker, price, last_update, market, outcome}]
  const sorted = [...offers].sort((a,b) => (b?.price ?? 0) - (a?.price ?? 0));
  return sorted.slice(0, 3);
}

function normalizeMarkets(oddsRaw = {}) {
  // Espera estructura estilo OddsAPI normalizada antes:
  // { markets: { '1x2': [offers...], 'btts': [...], 'over_2_5': [...], ... } }
  const markets = oddsRaw?.markets || {};
  const out = {};
  for (const [mkt, offers] of Object.entries(markets)) {
    out[mkt] = pickTop3(offers).map(o => ({
      bookie: o.bookmaker,
      price: o.price,
      last_update: o.last_update
    }));
  }
  return out;
}

function attachLeagueCountry(fx = {}) {
  const league = fx?.league_name || fx?.league || null;
  const country = fx?.country || fx?.league_country || fx?.country_name || null;
  return league && country ? `${league} (${country})` : (league || null);
}



async function enrichFixtureUsingOdds({ fixture, oddsRaw }) {
  const _fixture = fixture || {};
  let _odds = oddsRaw;

  // Si no viene oddsRaw y hay clave, intenta traer desde OddsAPI
  if (!_odds && process.env.ODDS_API_KEY) {
    try {
      _odds = await fetchOddsForFixture(_fixture);
    } catch (e) {
      if (Number(process.env.DEBUG_TRACE)) console.log('[ENRICH] fetch odds fail', e?.message || e);
    }
  }

  // Normalización flexible a markets {} y top3
  const marketsFlex = normalizeMarketsFlexible(_odds);
  const markets_top3 = toTop3ByMarket(marketsFlex);

  const mins = minutesUntil(_fixture?.kickoff);
  const when_text = Number.isFinite(mins)
    ? (mins >= 0 ? `Comienza en ${mins} minutos aprox` : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
    : null;

  const league_text = attachLeagueCountry(_fixture);

  const _fixture = fixture || {};
  let _odds = oddsRaw;

  // Si no viene oddsRaw y hay clave, intenta traer desde OddsAPI
  if (!_odds && process.env.ODDS_API_KEY) {
    try {
      _odds = await fetchOddsForFixture(_fixture);
    } catch (e) {
      if (Number(process.env.DEBUG_TRACE)) console.log('[ENRICH] fetch odds fail', e?.message || e);
    }
  }

  // fixture esperado (ejemplo):
  // { fixture_id, kickoff, league_id, league_name, country, home_id, away_id, ... }
  const topMarkets = normalizeMarkets(oddsRaw);
  const mins = minutesUntil(fixture?.kickoff);
  const whenTxt = Number.isFinite(mins) ? (mins >= 0 ? `Comienza en ${mins} minutos aprox`
                                                   : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
                                        : null;

  return { fixture_id: fixture?.fixture_id ?? null,
    , when_text
    , league: league_text
    , markets_top3
    kickoff: fixture?.kickoff ?? null,
    when_text: whenTxt,
    league: attachLeagueCountry(fixture),
    home_id: fixture?.home_id ?? null,
    away_id: fixture?.away_id ?? null,
    markets_top3: topMarkets,
  };
}

module.exports = { enrichFixtureUsingOdds, fetchOddsForFixture };

function _fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (d) => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchOddsForFixture(fixture){
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  const sport   = process.env.SPORT_KEY     || 'soccer';
  const regions = process.env.ODDS_REGIONS  || 'us,eu';
  const markets = process.env.ODDS_MARKETS  || 'h2h,btts,over_2_5,doublechance';
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${regions}&markets=${markets}&oddsFormat=decimal&dateFormat=iso&apiKey=${apiKey}`;
  try { return await _fetchJson(url); }
  catch (e) { if (Number(process.env.DEBUG_TRACE)) console.log('[ENRICH] OddsAPI error', e?.message || e); return null; }
}

function normalizeFromOddsAPIv4(oddsApiArray = []) {
  // oddsApiArray: [{bookmakers:[{markets:[{key,outcomes:[{name,price}]}]}], commence_time, home_team, away_team, ...}]
  const out = { markets: {} };
  for (const evt of (Array.isArray(oddsApiArray) ? oddsApiArray : [])) {
    const bms = Array.isArray(evt.bookmakers) ? evt.bookmakers : [];
    for (const bm of bms) {
      const bk = bm?.title || bm?.key || 'Unknown';
      const mkts = Array.isArray(bm.markets) ? bm.markets : [];
      for (const m of mkts) {
        const key = (m?.key || '').toLowerCase(); // ej: 'h2h', 'btts', 'totals'
        const outs = Array.isArray(m?.outcomes) ? m.outcomes : [];
        if (!out.markets[key]) out.markets[key] = [];
        for (const o of outs) {
          const price = typeof o?.price === 'number' ? o.price : Number(o?.price);
          if (!Number.isFinite(price)) continue;
          out.markets[key].push({
            bookmaker: bk,
            price,
            last_update: bm?.last_update || evt?.last_update || null,
            outcome: o?.name || null
          });
        }
      }
    }
  }
  return out;
}

function normalizeMarketsFlexible(oddsRaw) {
  if (!oddsRaw) return {};
  if (Array.isArray(oddsRaw)) {
    return normalizeFromOddsAPIv4(oddsRaw).markets || {};
  }
  return oddsRaw?.markets || {};
}

function toTop3ByMarket(markets = {}) {
  const out = {};
  for (const [mkt, offers] of Object.entries(markets)) {
    out[mkt] = pickTop3(offers).map(o => ({
      bookie: o.bookmaker,
      price: o.price,
      last_update: o.last_update
    }));
  }
  return out;
}
