'use strict';
const fetch = global.fetch || require('node-fetch');
const norm  = require('./_lib/normalize.cjs');


// [AF_HELPERS_IMPORT_V1]
const { listFixturesH2H: listFixturesH2H_shared } = require('./_lib/af-helpers.cjs');
const AF_BASE = 'https://v3.football.api-sports.io';
const nz  = v => v!==undefined && v!==null && v!=='';
const day = d => new Date(d).toISOString().slice(0,10);

function normTxt(s){ return norm.normTxt(String(s||'')).toLowerCase(); }
function scoreNameMatch(a,b){
  const A=normTxt(a), B=normTxt(b);
  if(!A||!B) return 0;
  if(A===B) return 1;
  if(A.includes(B)||B.includes(A)) return 0.85;
  const Sa=new Set(A.split(/\s+/).filter(Boolean));
  const Sb=new Set(B.split(/\s+/).filter(Boolean));
  const inter=[...Sa].filter(w=>Sb.has(w)).length;
  return inter ? Math.min(0.8, inter/Math.min(Sa.size,Sb.size)) : 0;
}
function isBTeam(name){
  try{
    const raw=String(name||'').toLowerCase();
    const toks=String(process.env.AF_BTEAM_WORDS || 'B,II,U19,U20,U21,U23,Reserves,Castilla,B-Team,B Team')
      .toLowerCase().split(/[,|]/).map(t=>t.trim()).filter(Boolean);
    return toks.some(t => raw.includes(t));
  }catch(_){return false;}
}
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
  return r.json();
}
async function findTeamIdBySearch(name, countryHint, key){
  // [AF_SENTINEL_FINDTEAM_FALLBACK_V1]
  const tryFetch = async (params) => {
    try { return await afFetch('/teams', params, key); } catch { return null; }
  };
  const score = (a,b)=>scoreNameMatch(a, (b||''));
  let best = null, bestScore = -1;

  // 1) Con countryHint (si viene)
  if (countryHint) {
    const j = await tryFetch({ search:String(name), country:countryHint });
    if (j && Array.isArray(j.response)) {
      for (const it of j.response) {
        const s = score(name, it?.team?.name);
        if (s > bestScore) { best = it; bestScore = s; }
      }
    }
  }

  // 2) Fallback sin country (mayor recall)
  if (!best) {
    const j2 = await tryFetch({ search:String(name) });
    if (j2 && Array.isArray(j2.response)) {
      for (const it of j2.response) {
        const s = score(name, it?.team?.name);
        if (s > bestScore) { best = it; bestScore = s; }
      }
    }
  }

  return best ? { id: best.team.id, name: best.team.name, country: best.team.country, score: bestScore } : null;
}
async function listFixturesByTeamWindow(teamId, dateISO, padDays, key){
  const base = new Date(dateISO+'T00:00:00Z');
  const from = new Date(base); from.setUTCDate(from.getUTCDate()-padDays);
  const to   = new Date(base); to.setUTCDate(to.getUTCDate()+padDays);
  const j = await afFetch('/fixtures', {
    team:String(teamId), from:day(from), to:day(to), timezone:'UTC', season: seasonOf(dateISO)
  }, key).catch(()=>null);
  return (j && Array.isArray(j.response)) ? j.response : [];
}

async function listFixturesByDateGlobal(dateISO, key){
  const j = await afFetch('/fixtures', { date: String(dateISO), timezone:'UTC' }, key).catch(()=>null);
  return (j && Array.isArray(j.response)) ? j.response : [];
}
async function listFixturesH2H(homeId, awayId, dateISO, padDays, key){
  // [AF_WRAP_H2H_V1] delega en helper compartido
  return await listFixturesH2H_shared(homeId, awayId, dateISO, padDays, key);
}
exports.handler = async (event) => {
  try{
    const qs = (event && event.queryStringParameters) || {};
    const homeName = String(qs.home || '').trim();
    const awayName = String(qs.away || '').trim();
    const leagueHint = String(qs.league_hint || '').trim();
    const countryHint= String(qs.country_hint|| '').trim();
    const when_text  = String(qs.when_text   || '').slice(0,10);
    const padDays = Math.max(0, Number(qs.pad || process.env.AF_MATCH_PAD_DAYS || 14));
    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || process.env.APIFOOTBALL_KEY || '';

    const THR = Number(process.env.SIM_THR || 0.60);
    const Wl  = Number(process.env.MATCH_LEAGUE_WEIGHT   || 0.10);
    const Wc  = Number(process.env.MATCH_COUNTRY_WEIGHT  || 0.05);
    const pen = Number(process.env.AF_BTEAM_PENALTY      || 0.20);
    const minL= Number(process.env.AF_LEAGUE_MIN_SIM     || 0);
    const minC= Number(process.env.AF_COUNTRY_MIN_SIM    || 0);

    if (!key) return { statusCode: 500, body: JSON.stringify({ error: 'NO_API_FOOTBALL_KEY' }) };
    if(!homeName||!awayName||!when_text) return { statusCode: 400, body: JSON.stringify({ error:'MISSING_PARAMS' }) };

    const [th, ta] = await Promise.all([
      findTeamIdBySearch(homeName, countryHint, key),
      findTeamIdBySearch(awayName, countryHint, key),
    ]);
    const ids = { home: th, away: ta };

    const [listH, listA] = await Promise.all([
      th?.id ? listFixturesByTeamWindow(th.id, when_text, padDays, key) : [],
      ta?.id ? listFixturesByTeamWindow(ta.id, when_text, padDays, key) : [],
    ]);
    const byId = new Map();
    for(const it of [...listH, ...listA]){
      const id = it?.fixture?.id;
      if(id && !byId.has(id)) byId.set(id, it);
    }
    let windowList = [...byId.values()];

    // --- H2H synthetic window if empty ---
    let h2hInfo = { used:false, closest:null };
    if ((!windowList || !windowList.length) && th?.id && ta?.id) {
      const hh = await listFixturesH2H(th.id, ta.id, when_text, padDays, key).catch(()=>[]);
      if (Array.isArray(hh) && hh.length) {
        // elegir el más cercano a la fecha objetivo
        let best=null, bestGap=1e18;
        for(const it of hh){
          const d = (it?.fixture?.date||'').slice(0,10);
          if(!d) continue;
          const gap = Math.abs(new Date(d) - new Date(when_text));
          if (gap < bestGap){ best=it; bestGap=gap; }
        }
        if (best) {
          h2hInfo = {
            used: true,
            closest: {
              fixture_id: best?.fixture?.id,
              when: (best?.fixture?.date||'').replace('Z',''),
              league: best?.league?.name,
              country: best?.league?.country,
              home: best?.teams?.home?.name,
              away: best?.teams?.away?.name,
            }
          };
          windowList = [best]; // usar como lista de trabajo
        }
      }
    }


    // --- Fallback: si no hay fixtures por team+window, escanear por día global ---
if (!windowList.length && ((th && th.id) || (ta && ta.id))) {
      const base = new Date(when_text+'T00:00:00Z');
      const from = new Date(base); from.setUTCDate(from.getUTCDate()-padDays);
      const to   = new Date(base); to.setUTCDate(to.getUTCDate()+padDays);
      const acc = [];
      for (let d=new Date(from); d<=to; d.setUTCDate(d.getUTCDate()+1)) {
        const arr = await listFixturesByDateGlobal(day(d), key);
        if (arr.length) acc.push(...arr);
      }
      // dedup por fixture.id
      const gmap = new Map();
      for (const it of acc) { const id = it?.fixture?.id; if(id && !gmap.has(id)) gmap.set(id,it); }
      windowList = [...gmap.values()];
    }


    const wantLeague = leagueHint;
    const wantCountry= countryHint;
    
    const scored = [];
    if ((!windowList || !windowList.length) && h2hInfo?.closest) {
      // synth score=0.5 (ajústalo si quieres); pass league/country si matchea hints
      const it = { fixture:{ id: h2hInfo.closest.fixture_id, date: h2hInfo.closest.when+'Z' },
                   league:{ name: h2hInfo.closest.league, country: h2hInfo.closest.country },
                   teams:{ home:{name:h2hInfo.closest.home}, away:{name:h2hInfo.closest.away} } };
      windowList = [it];
    }
  
    const counts = { window: (windowList||[]).length, pass_full: 0 };
  
    for(const it of windowList){
      const h = it?.teams?.home?.name || '';
      const a = it?.teams?.away?.name || '';
      const L = it?.league?.name || '';
      const C = it?.league?.country || '';

      let sH = scoreNameMatch(homeName, h);
      let sA = scoreNameMatch(awayName, a);

      if(pen > 0){
        const isBHome   = isBTeam(h);
        const isBAway   = isBTeam(a);
        const wantHomeB = isBTeam(homeName);
        const wantAwayB = isBTeam(awayName);
        if (isBHome && !wantHomeB) sH = Math.max(0, sH - pen);
        if (isBAway && !wantAwayB) sA = Math.max(0, sA - pen);
      }

      const sL = wantLeague ? scoreNameMatch(wantLeague, L) : 0;
      const sC = wantCountry? scoreNameMatch(wantCountry, C) : 0;

      const base = (sH + sA)/2;
      const score = base * (1 - (Wl + Wc)) + (sL * Wl) + (sC * Wc);

      const passTeams   = (sH >= THR) && (sA >= THR);
      const passLeague  = (!wantLeague || sL >= minL);
      const passCountry = (!wantCountry|| sC >= minC);

      if(passTeams && passLeague && passCountry){
        scored.push({
          fixture_id: it?.fixture?.id || null,
          when: (it?.fixture?.date||'').replace('Z',''),
          league: it?.league?.name || null,
          country: it?.league?.country || null,
          home: h, away: a,
          sH, sA, sL, sC, score,
          pass: { teams: passTeams, league: passLeague, country: passCountry }
        });
      }
    }
    scored.sort((x,y)=> y.score - x.score);

    let h2hUsed=false, h2hClosest=null;
    if(th?.id && ta?.id){
      h2hUsed=true;
      const h2h = await listFixturesH2H(th.id, ta.id, when_text, padDays, key);
      let best=null, bestGap=1e99;
      for(const it of h2h){
        const d = (it?.fixture?.date||'').slice(0,10);
        if(!d) continue;
        const gap = Math.abs(new Date(d) - new Date(when_text));
        if(gap < bestGap){ best=it; bestGap=gap; }
      }
      if(best){
        h2hClosest = {
          fixture_id: best?.fixture?.id || null,
          when: (best?.fixture?.date||'').replace('Z',''),
          league: best?.league?.name || null,
          country: best?.league?.country || null,
          home: best?.teams?.home?.name || null,
          away: best?.teams?.away?.name || null,
        };
      }
    }

    const out = {
      query: { homeName, awayName, league_hint: leagueHint, country_hint: countryHint, when_text, padDays,
               THR, Wl, Wc, pen, minL, minC },
      ids,
      counts: { window: windowList.length, pass_full: scored.length },
      top: scored.slice(0,25),
      h2h: { used: h2hUsed, closest: h2hClosest }
    };
    return { statusCode: 200, body: JSON.stringify(out, null, 2) };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};
