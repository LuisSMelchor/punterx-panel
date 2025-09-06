'use strict';
const fetch = global.fetch || require('node-fetch');


// [AF_HELPERS_IMPORT_V1]
const { listFixturesH2H } = require('./_lib/af-helpers.cjs');
const AF = 'https://v3.football.api-sports.io';
const nz = v => v!==undefined && v!==null && v!=='';
const norm = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();

/** Mínimo mapping (amplía cuando quieras) */
const TEAM_ID = new Map(Object.entries({
  "real madrid": 541,
  "barcelona": 529,
  "arsenal": 42,
  "chelsea": 49,
  "river plate": 435,
  "boca juniors": 451
}));

async function af(path, params, key){
  const url = new URL(AF + path);
  Object.entries(params||{}).forEach(([k,v])=>{ if(nz(v)) url.searchParams.set(k,String(v)); });
  const r = await fetch(url, { headers: { 'x-apisports-key': key } });
  if(!r.ok) throw new Error(`AF ${path} ${r.status}`);
  const jj = await r.json().catch(()=>null);
  return jj || null;
}

async function findTeamIdByAPI(name, country, key){
  if(!name) return null;
  // 1) name exacto (SIN country)
  let j = await af('/teams', { name }, key).catch(()=>null);
  let list = (j && Array.isArray(j.response)) ? j.response : [];
  // 2) search sin country
  if(!list.length){
    j = await af('/teams', { search:name }, key).catch(()=>null);
    list = (j && Array.isArray(j.response)) ? j.response : [];
  }
  // 3) search con country (si hay hint)
  if(!list.length && country){
    j = await af('/teams', { search:name, country }, key).catch(()=>null);
    list = (j && Array.isArray(j.response)) ? j.response : [];
  }
  if(!list.length) return null;

  // score simple
  const A = norm(name);
  let best=null, score=0;
  for(const it of list){
    const B = norm(it?.team?.name||'');
    let s=0;
    if(A && B){
      if(A===B) s=1;
      else if(A.includes(B)||B.includes(A)) s=0.85;
      else{
        const Sa=new Set(A.split(' ')), Sb=new Set(B.split(' '));
        const inter=[...Sa].filter(w=>Sb.has(w)).length;
        s = inter ? Math.min(0.8, inter/Math.min(Sa.size,Sb.size)) : 0;
      }
    }
    if(s>score){ best=it; score=s; }
  }
  return best ? { id: best.team.id, name: best.team.name, country: best.team.country, score } : null;
}

exports.handler = async (event) => {
  try{
    const qs = event?.queryStringParameters || {};
    const home = String(qs.home||'').trim();
    const away = String(qs.away||'').trim();
    const when = String(qs.when_text||'').slice(0,10);
    const country = String(qs.country_hint||'').trim(); // hint, opcional
    const pad  = Math.max(0, Number(qs.pad || process.env.AF_MATCH_PAD_DAYS || 28));
    const key  = process.env.API_FOOTBALL_KEY || '';

    if(!key) return { statusCode:500, body: JSON.stringify({ error:'NO_API_FOOTBALL_KEY' }) };
    if(!home || !away || !when) return { statusCode:400, body: JSON.stringify({ error:'MISSING_PARAMS' }) };

    // 1) intenta por API
    let th = await findTeamIdByAPI(home, country, key).catch(()=>null);
    let ta = await findTeamIdByAPI(away, country, key).catch(()=>null);

    // 2) fallback por mapa si algo faltó
    if(!th) { const id=TEAM_ID.get(norm(home)); if(id) th={ id, name:home, country:country||null, score:1 }; }
    if(!ta) { const id=TEAM_ID.get(norm(away)); if(id) ta={ id, name:away, country:country||null, score:1 }; }

    if(!th?.id || !ta?.id){
      return { statusCode:200, body: JSON.stringify({ query:{home,away,when,country,pad}, ids:{home:th||null, away:ta||null}, closest:null }) };
    }

    const base = new Date(when+'T00:00:00Z');
    const from = new Date(base); from.setUTCDate(from.getUTCDate()-pad);
    const to   = new Date(base); to.setUTCDate(to.getUTCDate()+pad);

    const list = await listFixturesH2H(th.id, ta.id, when, pad, key);
    let best=null, bestGap=Infinity;
    for(const it of list){
      const d = (it?.fixture?.date||'').slice(0,10);
      if(!d) continue;
      const gap = Math.abs(new Date(d) - base);
      if(gap < bestGap){ best=it; bestGap=gap; }
    }
    const out = best ? {
      fixture_id: best.fixture?.id,
      when: (best.fixture?.date||'').replace('Z',''),
      league: best.league?.name,
      country: best.league?.country,
      home: best.teams?.home?.name,
      away: best.teams?.away?.name
    } : null;

    return { statusCode:200, body: JSON.stringify({ query:{home,away,when,country,pad}, ids:{home:th, away:ta}, closest: out }) };
  }catch(e){
    return { statusCode:500, body: JSON.stringify({ error:String(e && e.message || e) }) };
  }
};
