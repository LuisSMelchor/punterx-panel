const { test } = require('node:test');
const assert = require('node:assert/strict');

test('cache hit after first miss + retry success', async () => {
  delete require.cache[require.resolve('../run-picks-scan-markets.cjs')];
  const mod = require('../run-picks-scan-markets.cjs');

  // stub __fetch: 1º intento -> 500; siguientes -> 200 con JSON válido
  let calls = 0;
  const fakeResp = (ok, json, status = ok ? 200 : 500) => ({ ok, status, json: async () => json });
  const stub = async () => {
    calls++;
    if (calls === 1) return fakeResp(false, {}, 500);
    return fakeResp(true, { bookmakers: [{ key: 'stub', markets: [] }] });
  };

  if (mod.__test && typeof mod.__test.__setFetch === 'function') mod.__test.__setFetch(stub);
  else mod.__fetch = stub;

  const evt = { home:'H', away:'A', league:'X', commence:'2025-01-01T00:00:00Z' };
  const base = 'http://localhost:4999/.netlify/functions';

  // 1ª llamada: miss + retry => ok
  const first = await mod.__odds_enrich_fetch(base, evt);
  assert.ok(Array.isArray(first) && first.length === 1, 'first enrich result');

  // 2ª llamada: cache hit (no incrementa calls)
  const cBefore = calls;
  const second = await mod.__odds_enrich_fetch(base, evt);
  assert.ok(Array.isArray(second) && second.length === 1, 'cached result');
  assert.equal(calls, cBefore, 'second call served from cache');
});
