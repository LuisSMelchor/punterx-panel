'use strict';
// [AF_HELPERS_V1]
const fetch = global.fetch || require('node-fetch');
const AF_BASE = 'https://v3.football.api-sports.io';
const nz  = v => v!==undefined && v!==null && v!=='';
const day = d => new Date(d).toISOString().slice(0,10);

function seasonOf(dateISO){
  try{
    const d = new Date(String(dateISO||'')+'T00:00:00Z');
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth()+1;
    return (m < 7) ? (y-1) : y;
  }catch(_){ return undefined; }
}

async function afFetch(path, params, key){
  const url = new URL(AF_BASE + path);
  Object.entries(params||{}).forEach(([k,v])=>{ if(nz(v)) url.searchParams.set(k,String(v)); });
  const r = await fetch(url, { headers: { 'x-apisports-key': key }});
  if(!r.ok) throw new Error(`AF ${path} ${r.status}`);
  const jj = await r.json().catch(()=>null);
  return jj || null;
}

async function listFixturesH2H(homeId, awayId, dateISO, padDays, key){
  const base = new Date(String(dateISO||'')+'T00:00:00Z');
  const from = new Date(base); from.setUTCDate(from.getUTCDate()-Number(padDays||0));
  const to   = new Date(base); to.setUTCDate(to.getUTCDate()+Number(padDays||0));
  const j = await afFetch('/fixtures/headtohead', {
    h2h: String(homeId)+'-'+String(awayId),
    from: day(from),
    to:   day(to),
    timezone: 'UTC',
    season: seasonOf(dateISO)
  }, key).catch(()=>null);
  return (j && Array.isArray(j.response)) ? j.response : [];
}

module.exports = { listFixturesH2H, seasonOf, afFetch };
