'use strict';

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
  // fixture esperado (ejemplo):
  // { fixture_id, kickoff, league_id, league_name, country, home_id, away_id, ... }
  const topMarkets = normalizeMarkets(oddsRaw);
  const mins = minutesUntil(fixture?.kickoff);
  const whenTxt = Number.isFinite(mins) ? (mins >= 0 ? `Comienza en ${mins} minutos aprox`
                                                   : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
                                        : null;

  return {
    fixture_id: fixture?.fixture_id ?? null,
    kickoff: fixture?.kickoff ?? null,
    when_text: whenTxt,
    league: attachLeagueCountry(fixture),
    home_id: fixture?.home_id ?? null,
    away_id: fixture?.away_id ?? null,
    markets_top3: topMarkets,
  };
}

module.exports = {
  enrichFixtureUsingOdds,
};
