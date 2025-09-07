// netlify/functions/diag-match-compare.cjs
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const safeParse = (s) => { try { return JSON.parse(s) } catch { return null } };

function loadCompare() {
  const rq = eval('require'), p = rq('path'), fs = rq('fs');
  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const candidates = [
    p.join(base, '_lib/match-compare.cjs'),
    p.join(base, 'netlify/functions/_lib/match-compare.cjs'),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return rq(c); } catch {} }
  return rq('_lib/match-compare.cjs');
}

function readFixtureFromBundle(name) {
  const rq = eval('require'); const p = rq('path'); const fs = rq('fs');
  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const file = p.join(base, 'tests/matching-fixtures', String(name || '').replace(/\.\.+/g,''));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const { compareFixtures, decide } = loadCompare();

exports.handler = async (event) => {
  const qs = event?.queryStringParameters || {};
  let A = null, B = null, source = 'none';

  if (event?.httpMethod === 'POST' && event.body) {
    const body = safeParse(event.body);
    if (body?.a) A = body.a;
    if (body?.b) B = body.b;
    source = 'post';
  } else if (qs.a && qs.b) {
    A = readFixtureFromBundle(qs.a);
    B = readFixtureFromBundle(qs.b);
    source = `files:${qs.a},${qs.b}`;
  }

  if (!A || !B) {
    return __json(400, { ok:false, error:'missing-fixtures', hint:'GET ?a=demo-1.json&b=demo-1b.json o POST {a,b}' });
  }

  const out = compareFixtures(A, B);
  out.decision = decide(out.score, out.parts);
  out.ok = true;
  out.source = source;
  return __json(200, out);
};
