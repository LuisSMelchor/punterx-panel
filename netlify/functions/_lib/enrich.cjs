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

module.exports = { enrichFixtureUsingOdds, fetchOddsForFixture, marketKeyCanonical, preferredCanonMarkets, normalizeFromOddsAPIv4, toTop3ByMarket, buildOneShotPayload, oneShotPayload };

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
  const out = { markets: {} };
  for (const evt of (Array.isArray(oddsApiArray) ? oddsApiArray : [])) {
    const bms = Array.isArray(evt.bookmakers) ? evt.bookmakers : [];
    for (const bm of bms) {
      const bk = bm?.title || bm?.key || 'Unknown';
      const mkts = Array.isArray(bm.markets) ? bm.markets : [];
      for (const mkt of mkts) {
        const rawKey = mkt?.key || '';
        const canon = marketKeyCanonical(rawKey);
        const outs = Array.isArray(mkt?.outcomes) ? mkt.outcomes : [];
        // 1) Mercado directo (h2h, btts, doublechance)
        if (canon !== 'totals') {
          if (!out.markets[canon]) out.markets[canon] = [];
          for (const o of outs) {
            const price = typeof o?.price === 'number' ? o.price : Number(o?.price);
            if (!Number.isFinite(price)) continue;
            out.markets[canon].push({
              bookmaker: bk,
              price,
              last_update: bm?.last_update || evt?.last_update || null,
              outcome: o?.name || null
            });
          }
        } else {
          // 2) totals → derivar over_2_5 cuando point=2.5 y outcome "Over"
          const point = (typeof mkt?.point === 'number' ? mkt.point : Number(mkt?.point));
          if (Number.isFinite(point) && Math.abs(point - 2.5) < 1e-6) {
            if (!out.markets['over_2_5']) out.markets['over_2_5'] = [];
            for (const o of outs) {
              const name = String(o?.name || '').toLowerCase().trim();
              if (name === 'over') {
                const price = typeof o?.price === 'number' ? o.price : Number(o?.price);
                if (!Number.isFinite(price)) continue;
                out.markets['over_2_5'].push({
                  bookmaker: bk,
                  price,
                  last_update: bm?.last_update || evt?.last_update || null,
                  outcome: 'Over 2.5'
                });
              }
            }
          }
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
  const allow = new Set(preferredCanonMarkets());
  const out = {};
  for (const [mkt, offers] of Object.entries(markets)) {
    if (!allow.has(mkt)) continue; // filtra solo los canónicos
    out[mkt] = pickTop3(offers).map(o => ({
      bookie: o.bookmaker,
      price: o.price,
      last_update: o.last_update
    }));
  }
  return out;
}
;
  for (const [mkt, offers] of Object.entries(markets)) {
    out[mkt] = pickTop3(offers).map(o => ({
      bookie: o.bookmaker,
      price: o.price,
      last_update: o.last_update
    }));
  }
  return out;
}

function marketKeyCanonical(key='') {
  const k = String(key || '').toLowerCase().trim();
  if (k === 'h2h') return '1x2';
  if (k === 'both_teams_to_score' || k === 'btts') return 'btts';
  if (k === 'doublechance' || k === 'double_chance') return 'doublechance';
  if (k === 'totals') return 'totals';
  return k; // por defecto, conserva
}

function preferredCanonMarkets() {
  const raw = process.env.ODDS_MARKETS_CANON || '1x2,btts,over_2_5,doublechance';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

function buildOneShotPayload({ evt = {}, match = {}, enriched = {} } = {}) {
  const fx = {
    fixture_id: enriched?.fixture_id ?? match?.fixture_id ?? null,
    league: enriched?.league ?? match?.league_name ?? null,
    kickoff: evt?.commence ?? null,
    when_text: enriched?.when_text ?? null,
    league_id: match?.league_id ?? null,
    home_id: match?.home_id ?? null,
    away_id: match?.away_id ?? null
  };

  // markets_top3 ya normalizados en enriched
  const markets = enriched?.markets_top3 || {};

  // Paquete canónico y compacto
  return {
    fixture: fx,
    markets,
    meta: {
      method: match?.method || 'unknown',
      confidence: match?.confidence ?? null,
      source: 'OddsAPI+AF',
      ts: new Date().toISOString()
    }
  };
}

async function oneShotPayload({ evt, match, fixture }) {
  // Si ya viene enriched desde fuera, respétalo:
  let enriched;
  if (fixture && typeof fixture === 'object') {
    // Asegura que pase por enrichFixtureUsingOdds para obtener markets_top3
    enriched = await enrichFixtureUsingOdds({ fixture });
  } else {
    // fallback minimal: sin fixture no armamos enriched
    enriched = {};
  }
  return buildOneShotPayload({ evt, match, enriched });
}
