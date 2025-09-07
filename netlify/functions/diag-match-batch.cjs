// netlify/functions/diag-match-batch.cjs
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const safeParse = (s) => { try { return JSON.parse(s) } catch { return null } };

function loadLib() {
  const rq = eval('require');
  const p = rq('path');
  const fs = rq('fs');
  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const candidates = [
    p.join(base, '_lib/match-normalize.cjs'),
    p.join(base, 'netlify/functions/_lib/match-normalize.cjs'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return rq(c); } catch {}
  }
  return rq('_lib/match-normalize.cjs');
}
const Lib = loadLib();
const { normalizeFixture } = Lib;

function loadFixturesFromTests() {
  const rq = eval('require'); const fs = rq('fs'); const path = rq('path');
  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const root = path.join(base, 'tests/matching-fixtures');
  let files = [];
  try { files = fs.readdirSync(root).filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const name of files) {
    try {
      const txt = fs.readFileSync(path.join(root, name), 'utf8');
      const j = safeParse(txt);
      if (j && typeof j === 'object') out.push(j);
    } catch {}
  }
  return out;
}

exports.handler = async (event) => {
  const qs = event?.queryStringParameters || {};
  let fixtures = [];

  if (event?.httpMethod === 'POST' && event.body) {
    const body = safeParse(event.body);
    if (body?.fixtures && Array.isArray(body.fixtures)) fixtures = body.fixtures;
  }
  if (fixtures.length === 0) fixtures = loadFixturesFromTests();

  const results = fixtures.map(normalizeFixture);

  const byKey = new Map();
  for (const r of results) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  const collisions = [];
  for (const [k, arr] of byKey.entries()) if (arr.length > 1) collisions.push({ key: k, count: arr.length });

  const byBand = {};
  for (const r of results) byBand[r.timing.band] = (byBand[r.timing.band] || 0) + 1;

  const max = Number(qs.max || 100);
  const sample = results.slice(0, Math.max(0, max));

  return __json(200, {
    ok: true,
    source: fixtures.length ? 'fixtures' : 'empty',
    total: results.length,
    bands: byBand,
    collisions_count: collisions.length,
    collisions,
    sample_count: sample.length,
    sample
  });
};
