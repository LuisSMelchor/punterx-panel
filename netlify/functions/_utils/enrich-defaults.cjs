'use strict';

function ensureEnrichDefaults(payload) {
  const out = (payload && typeof payload === 'object') ? payload : {};
  out.events = Array.isArray(out.events) ? out.events : [];
  out.markets = (out.markets && typeof out.markets === 'object') ? out.markets : {};
  out.markets_top3 = (out.markets_top3 && typeof out.markets_top3 === 'object') ? out.markets_top3 : {};
  return out;
}

module.exports = { ensureEnrichDefaults };
