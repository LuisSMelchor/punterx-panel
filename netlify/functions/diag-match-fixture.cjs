// netlify/functions/diag-match-fixture.cjs
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const qbool = (v) => v === '1' || v === 'true' || v === 'yes';
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
  // último intento por nombre plano (por si el bundler resolvió así)
  return rq('_lib/match-normalize.cjs');
}

const Lib = loadLib();
const { normalizeFixture, TEAM_STOPWORDS } = Lib;

function readFixtureFromBundle(name) {
  const rq = eval('require');
  const p = rq('path');
  const fs = rq('fs');
  const base = process.env.LAMBDA_TASK_ROOT || __dirname;
  const file = p.join(base, 'tests/matching-fixtures', String(name || '').replace(/\.\.+/g,''));
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

exports.handler = async (event) => {
  const qs = event?.queryStringParameters || {};
  let payload = null;
  let source = 'none';

  if (event?.httpMethod === 'POST' && event.body) {
    payload = safeParse(event.body);
    source = 'post';
  } else if (qs.file) {
    payload = readFixtureFromBundle(qs.file);
    source = `file:${qs.file}`;
  } else if (qbool(qs.sample)) {
    payload = readFixtureFromBundle('demo-1.json');
    source = 'sample';
  }

  if (!payload || typeof payload !== 'object') {
    return __json(400, { ok:false, error:'no-fixture', hint:"POST JSON o usa ?file=demo-1.json o ?sample=1" });
  }

  const out = normalizeFixture(payload);
  if (qbool(qs.debug)) out.debug = { team_stopwords_size: TEAM_STOPWORDS.size };
  out.ok = true;
  out.source = source;
  
/* __PX_FX_RETURN__ :: devolver normalizado (coacción commence/kickoff→start_ts) */
{
  // conserva flags útiles
  try { out.ok = true; out.source = source; } catch {}
  
/* __PX_FORCE_LIB_NORM__ :: usar normalizeFixture exportado (commence/kickoff→start_ts; sec→ms) */
{
  const out = normalizeFixture(payload || {});
  try { out.ok = true; out.source = source; } catch {}
  return __json(200, out);
}

}

};
