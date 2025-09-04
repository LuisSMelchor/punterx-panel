const { test } = require('node:test');
const assert = require('node:assert/strict');
const mod = require('../run-picks-scan-markets.cjs');

test('__resolveFunctionsBase dev host', () => {
  const base = mod.__test.__resolveFunctionsBase({ headers: { host: 'localhost:4999', 'x-forwarded-proto': 'http' }});
  assert.equal(base, 'http://localhost:4999/.netlify/functions');
});

test('__withTimeout exists and returns signal', () => {
  const obj = mod.__test.__withTimeout(5);
  assert.ok(obj && 'signal' in obj && typeof obj.cancel === 'function');
  obj.cancel();
});

test('__withRetry basic shape', async () => {
  let tries = 0;
  const res = await mod.__test.__withRetry(async () => {
    tries++;
    if (tries < 2) throw new Error('nope');
    return 'ok';
  }, { retries: 2, baseDelay: 1 });
  assert.equal(res, 'ok');
});
