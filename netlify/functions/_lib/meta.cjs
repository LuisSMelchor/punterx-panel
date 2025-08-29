'use strict';

function ensureEnrichDefaults(payload, { optIn=false, source='oddsapi:events' } = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  p.meta = (p.meta && typeof p.meta === 'object') ? p.meta : {};

  if (optIn) {
    if (!p.meta.enrich_attempt) p.meta.enrich_attempt = source;
    if (!p.meta.odds_source)    p.meta.odds_source    = source;
  } else {
    if (!p.meta.enrich_attempt) p.meta.enrich_attempt = 'skipped';
  }
  return p;
}

function setEnrichStatus(payload, status) {
  const p = payload && typeof payload === 'object' ? payload : {};
  p.meta = (p.meta && typeof p.meta === 'object') ? p.meta : {};
  if (!p.meta.enrich_attempt) p.meta.enrich_attempt = 'skipped';
  if (status === 'ok')      p.meta.enrich_status = 'ok';
  else if (status === 'error') p.meta.enrich_status = 'error';
  return p;
}

module.exports = { ensureEnrichDefaults, setEnrichStatus };
