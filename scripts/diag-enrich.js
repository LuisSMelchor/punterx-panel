'use strict';

const { enrichFixtureUsingOdds } = require('../netlify/functions/_lib/enrich.cjs');

// Simulación rápida de oddsRaw (estructura mínima)
const sampleOdds = {
  markets: {
    '1x2': [
      { bookmaker: 'BookieA', price: 2.10, last_update: '2025-08-20T12:00:00Z' },
      { bookmaker: 'BookieB', price: 2.05, last_update: '2025-08-21T10:30:00Z' },
      { bookmaker: 'BookieC', price: 2.00, last_update: '2025-08-21T11:00:00Z' },
      { bookmaker: 'BookieD', price: 1.98, last_update: '2025-08-21T12:00:00Z' },
    ],
    'btts': [
      { bookmaker: 'BookieA', price: 1.85, last_update: '2025-08-21T12:05:00Z' },
      { bookmaker: 'BookieC', price: 1.90, last_update: '2025-08-21T12:10:00Z' },
    ],
    'over_2_5': [
      { bookmaker: 'BookieB', price: 1.95, last_update: '2025-08-21T12:15:00Z' },
      { bookmaker: 'BookieA', price: 1.92, last_update: '2025-08-21T12:17:00Z' },
      { bookmaker: 'BookieD', price: 1.88, last_update: '2025-08-21T12:19:00Z' },
    ],
  }
};

// Fixture realista: usa el que te devolvió el smoke MLS
const fixtureFromSmoke = {
  fixture_id: 1326618,
  kickoff: '2025-08-24T23:00:00Z',
  league_id: 253,
  league_name: 'Major League Soccer',
  country: 'USA',
  home_id: 18310,
  away_id: 1602,
};

(async () => {
  const out = await enrichFixtureUsingOdds({ fixture: fixtureFromSmoke, oddsRaw: sampleOdds });
  console.log('[ENRICHED]', JSON.stringify(out, null, 2));
})();
