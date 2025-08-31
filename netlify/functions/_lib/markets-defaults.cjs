'use strict';

const DEF = {
  min_books_1x2: 1,
  min_books_btts: 1,
  min_books_ou25: 1,
  min_books_dnb: 1,
  // nombres “probables” de mercados en OddsAPI (robusto a variaciones comunes)
  keys: {
    h2h: ['h2h','1x2','match_odds'],
    btts: ['both_teams_to_score','btts','goals_both_teams'],
    ou: ['totals','over_under','goal_totals'],
    dnb: ['draw_no_bet','dnb']
  }
};

const envNumber = (k, d) => {
  const n = Number(process.env[k]); 
  return Number.isFinite(n) && n > 0 ? n : d;
};

function readMinBooks(env = process.env) {
  return {
    min_books_1x2: envNumber('MIN_BOOKS_1X2', DEF.min_books_1x2),
    min_books_btts: envNumber('MIN_BOOKS_BTTS', DEF.min_books_btts),
    min_books_ou25: envNumber('MIN_BOOKS_OU25', DEF.min_books_ou25),
    min_books_dnb: envNumber('MIN_BOOKS_DNB', DEF.min_books_dnb),
  };
}

function imp(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  // price → implied (decimal odds → 1/odds)
  if (n > 1.0001) return 1 / n;
  // si ya es probabilidad (0..1) la devolvemos tal cual
  if (n >= 0 && n <= 1) return n;
  return null;
}

module.exports = { DEF, readMinBooks, imp };
