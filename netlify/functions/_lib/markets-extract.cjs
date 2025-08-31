'use strict';

const { DEF, readMinBooks, imp } = require('./markets-defaults.cjs');

// busca por nombre de mercado tolerante a variantes
function findMarket(book, keys) {
  if (!book || !Array.isArray(book.markets)) return null;
  const kmatch = (k) => (m) => (m && typeof m.key==='string' && m.key.toLowerCase().includes(k));
  for (const want of keys) {
    const k = String(want).toLowerCase();
    const hit = book.markets.find(kmatch(k));
    if (hit) return hit;
  }
  return null;
}

function bestProb(samples = []) {
  // puedes ajustar la agregación; por ahora: promedio simple de implied
  const S = samples.filter(x => Number.isFinite(x) && x > 0 && x < 1);
  if (!S.length) return 0;
  const avg = S.reduce((a,b)=>a+b,0)/S.length;
  return Math.max(0, Math.min(1, avg));
}

function extractFromOddsAPI(event, oddsapiEvent, opts = {}) {
  const min = { ...readMinBooks(), ...opts };
  const keys = (opts.keys || DEF.keys);

  const books = Array.isArray(oddsapiEvent?.bookmakers) ? oddsapiEvent.bookmakers : [];
  const has = new Set();

  // 1) 1x2 ya lo usas, pero por si no llega: calculamos score_1x2 ~ max(prob local/visit/empate) o prob del favorito
  let p1x2 = [];
  for (const b of books) {
    const mk = findMarket(b, keys.h2h);
    if (!mk || !Array.isArray(mk.outcomes)) continue;
    const implied = mk.outcomes.map(o => imp(o.price));
    const best = bestProb(implied);
    if (best) p1x2.push(best);
  }
  const score_1x2 = (p1x2.length >= min.min_books_1x2) ? bestProb(p1x2) : 0;
  if (score_1x2) has.add('1x2');

  // 2) BTTS (Yes/No). Tomamos prob(Yes)
  let pbtts = [];
  for (const b of books) {
    const mk = findMarket(b, keys.btts);
    if (!mk || !Array.isArray(mk.outcomes)) continue;
    const yes = mk.outcomes.find(o => /yes/i.test(o.name||''));
    const py = yes ? imp(yes.price) : null;
    if (py) pbtts.push(py);
  }
  const score_btts = (pbtts.length >= min.min_books_btts) ? bestProb(pbtts) : 0;
  if (score_btts) has.add('btts');

  // 3) OU 2.5 (Over). Buscamos línea 2.5; si hay múltiples, elegimos la más cercana a 2.5
  let pou = [];
  for (const b of books) {
    const mk = findMarket(b, keys.ou);
    if (!mk || !Array.isArray(mk.outcomes)) continue;
    // outcomes pueden venir con .name "Over 2.5"/"Under 2.5" o con .point
    const candidates = mk.outcomes.map(o => {
      const lineText = String(o.name||''); 
      const m = lineText.match(/([0-9]+(\.[0-9]+)?)/);
      const point = Number.isFinite(Number(o.point)) ? Number(o.point) : (m ? Number(m[1]) : NaN);
      return { point, price:o.price, name:o.name };
    }).filter(x => Number.isFinite(x.point));
    if (!candidates.length) continue;
    // la línea más cercana a 2.5
    candidates.sort((a,b) => Math.abs(a.point-2.5)-Math.abs(b.point-2.5));
    const bestLine = candidates[0]?.point;
    const over = mk.outcomes.find(o => {
      const isOver = /over/i.test(o.name||'');
      const p = Number.isFinite(Number(o.point)) ? Number(o.point) : NaN;
      const textMatch = (new RegExp(`over\\s*${bestLine}`, 'i')).test(o.name||'');
      return isOver && (p===bestLine || textMatch);
    });
    const po = over ? imp(over.price) : null;
    if (po) pou.push(po);
  }
  const score_ou25 = (pou.length >= min.min_books_ou25) ? bestProb(pou) : 0;
  if (score_ou25) has.add('ou25');

  // 4) DNB (Home/Away). Tomamos prob del lado favorito (máx prob)
  let pdnb = [];
  for (const b of books) {
    const mk = findMarket(b, keys.dnb);
    if (!mk || !Array.isArray(mk.outcomes)) continue;
    const imps = mk.outcomes.map(o => imp(o.price)).filter(Boolean);
    const best = bestProb(imps);
    if (best) pdnb.push(best);
  }
  const score_dnb = (pdnb.length >= min.min_books_dnb) ? bestProb(pdnb) : 0;
  if (score_dnb) has.add('dnb');

  const has_markets = Array.from(has);
  return { score_1x2, score_btts, score_ou25, score_dnb, has_markets };
}

module.exports = { extractFromOddsAPI };
