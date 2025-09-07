// netlify/functions/diag-norm-label.cjs
'use strict';
let norm = null; try { norm = require('./_lib/match-normalize.cjs'); } catch(_) {}
const ok  = (o)=>({ statusCode:200, headers:{'content-type':'application/json'}, body:JSON.stringify(o) });

exports.handler = async (event) => {
  const q = event?.queryStringParameters || {};
  const home = (q.home || '').trim();
  const away = (q.away || '').trim();

  const normalizeTeam = (norm && typeof norm.normalizeTeam==='function') ? norm.normalizeTeam : (s=>s);
  const homeN = normalizeTeam(home);
  const awayN = normalizeTeam(away);

  const labelRaw = `${home} vs ${away}`;
  const labelNorm = `${homeN || home} vs ${awayN || away}`;

  return ok({ ok:true, labelRaw, labelNorm, parts: { home, away, homeN, awayN }});
};
