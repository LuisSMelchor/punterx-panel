'use strict';
const af = require('./_lib/resolver-af.cjs');

exports.handler = async () => {
  try {
    const ok = !!af && typeof af.resolveTeamsAndLeague === 'function';
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok, exports: Object.keys(af || {}) })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: String((e && e.stack) || (e && e.message) || e || 'internal error')
    };
  }
};
