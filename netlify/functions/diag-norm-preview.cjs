// netlify/functions/diag-norm-preview.cjs
'use strict';
let norm = null; try { norm = require('./_lib/match-normalize.cjs'); } catch(_) {}
const ok  = (o)=>({ statusCode:200, headers:{'content-type':'application/json'}, body:JSON.stringify(o) });
const err = (o)=>({ statusCode:500, headers:{'content-type':'application/json'}, body:JSON.stringify(o) });

exports.handler = async (event) => {
  try {
    const q = event?.queryStringParameters || {};
    const a = (q.a || '').trim();
    const b = (q.b || '').trim();
    const normalizeTeam = (norm && typeof norm.normalizeTeam==='function') ? norm.normalizeTeam : (s=>s);
    const compareTeams  = (norm && typeof norm.compareTeams==='function') ? norm.compareTeams : ((x,y)=>({ score: x===y?1:0 }));

    const aN = normalizeTeam(a), bN = normalizeTeam(b);
    const cmp = compareTeams(a, b);

    return ok({
      ok: true,
      input: { a, b },
      normalized: { a: aN, b: bN },
      compare: cmp
    });
  } catch(e){
    return err({ ok:false, error: e?.message || String(e) });
  }
};
