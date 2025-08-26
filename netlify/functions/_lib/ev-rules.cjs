'use strict';

function classifyEV(evPct) {
  if (!Number.isFinite(evPct)) return 'descartado';
  if (evPct >= 15) return 'vip';     // VIP ≥ 15%
  if (evPct >= 10) return 'free';    // Gratis 10–14.99%
  return 'descartado';
}

function isPublishable(level) {
  return level === 'vip' || level === 'free';
}

module.exports = { classifyEV, isPublishable };
