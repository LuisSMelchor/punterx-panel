"use strict";
/** Resolver AF genérico (sin listas fijas) */
const _norm = require("./normalize.cjs");
const AF_BASE = "https://v3.football.api-sports.io";

// Logger controlado por AF_VERBOSE (1=on)
const DBG = (...a)=>{ try{ if(Number(process.env.AF_VERBOSE ?? 0)) console.log('[AF_DEBUG]', ...a); }catch(_){} };

const get = (o,p,d)=>{try{return p.split(".").reduce((x,k)=>(x??{})[k],o)}catch(_){return d}};
const nz  = v => v!==undefined && v!==null && v!=="";

function scoreNameMatch(a,b){
  const A=_norm.normTxt(String(a||"")).toLowerCase();
  const B=_norm.normTxt(String(b||"")).toLowerCase();
  if(!A||!B) return 0;
  if(A===B) return 1.0;
  if(A.includes(B)||B.includes(A)) return 0.85;
  const Sa=new Set(A.split(/\s+/).filter(Boolean));
  const Sb=new Set(B.split(/\s+/).filter(Boolean));
  const inter=[...Sa].filter(w=>Sb.has(w)).length;
  return inter ? Math.min(0.8, inter/Math.min(Sa.size,Sb.size)) : 0;
}
async function afFetch(path, params, key){
  const url = new URL(AF_BASE + path);
  Object.entries(params||{}).forEach(([k,v])=>{ if(nz(v)) url.searchParams.set(k,String(v)); });
  const r = await fetch(url, { headers: { "x-apisports-key": key } });
  if(!r.ok){ const t=await r.text().catch(()=> ""); throw new Error(`[AF] ${r.status} ${r.statusText} ${url} :: ${t.slice(0,200)}`); }
  return r.json();
}

async function findTeamIdBySearch(name, countryHint, key){
  const q = _norm.normalizeTeam(name);
  const res = await afFetch("/teams", { search:q }, key);
  const items = Array.isArray(res?.response)? res.response : [];
  let best=null, bs=-1;
  for(const it of items){
    const n = get(it,"team.name",""); const c = get(it,"team.country","");
    let s = scoreNameMatch(q,n);
    if(countryHint){ const sc = scoreNameMatch(_norm.normalizeCountryHint(countryHint), c); s = s*0.9 + sc*0.1; }
    if(s>bs){ best=it; bs=s; }
  }
  return { id:get(best,"team.id",null), name:get(best,"team.name",null), country:get(best,"team.country",null), score:bs };
}
function dayISO(d){ return new Date(d).toISOString().slice(0,10); }
function around(dateISO, padDays=2){
  const d = new Date(dateISO+"T00:00:00Z");
  const from = new Date(d); from.setUTCDate(from.getUTCDate()-padDays);
  const to   = new Date(d); to.setUTCDate(to.getUTCDate()+padDays);
  return { from: dayISO(from), to: dayISO(to) };
}

async function findFixture({ dateISO, homeId, awayName, leagueHint, countryHint, key, verbose }){
  const {from,to}=around(dateISO,2);
  const r = await afFetch("/fixtures", { team: homeId, from, to, timezone:"UTC" }, key);
  const list = Array.isArray(r?.response)? r.response : [];
  const wantAway   = _norm.normalizeTeam(awayName);
  const wantLeague = _norm.normalizeLeagueHint(leagueHint);
  const wantCountry= _norm.normalizeCountryHint(countryHint);
  const THR = Number(process.env.SIM_THR ?? 0.60);
  let best=null, bs=-1;
  for(const it of list){
    const away = get(it,"teams.away.name",""); const league=get(it,"league.name",""); const country=get(it,"league.country","");
    const sAway = scoreNameMatch(wantAway, away); if(sAway < THR) continue;
    const sL = wantLeague? scoreNameMatch(wantLeague, league) : 0.5;
    const sC = wantCountry? scoreNameMatch(wantCountry,country): 0.5;
    const s = sAway*0.75 + sL*0.15 + sC*0.10;
    if(s>bs){ best=it; bs=s; }
  }
  if(verbose && best){ best.__match_debug = { mode:"teamWindow", score:bs, thr:THR, wantAway, wantLeague, wantCountry }; }
  return best||null;
}
async function findFixtureByDateAll({ dateISO, homeName, awayName, leagueHint, countryHint, key, verbose }){
  const r = await afFetch("/fixtures", { date: dateISO, timezone:"UTC" }, key);
  const list = Array.isArray(r?.response)? r.response : [];
  const wantHome   = _norm.normalizeTeam(homeName);
  const wantAway   = _norm.normalizeTeam(awayName);
  const wantLeague = _norm.normalizeLeagueHint(leagueHint);
  const wantCountry= _norm.normalizeCountryHint(countryHint);
  const THR = Number(process.env.SIM_THR ?? 0.60);
  let best=null, bs=-1;
  for(const it of list){
    const h = it?.teams?.home?.name || ""; const a = it?.teams?.away?.name || "";
    const L = it?.league?.name || ""; const C = it?.league?.country || "";
    const sH = scoreNameMatch(wantHome, h); const sA = scoreNameMatch(wantAway, a);
    if (sH < THR || sA < THR) continue;
    const sL = wantLeague?  scoreNameMatch(wantLeague,  L) : 0.5;
    const sC = wantCountry? scoreNameMatch(wantCountry, C) : 0.5;
    const s = sH*0.40 + sA*0.40 + sL*0.10 + sC*0.10;
    if (s>bs){ best=it; bs=s; }
  }
  if (verbose && best){ best.__match_debug = { mode:"dateAll", score:bs, thr:THR, wantHome, wantAway, wantLeague, wantCountry }; }
  return best || null;
}
async function resolveTeamsAndLeague(evt, opts={}){
  const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || process.env.APIFOOTBALL_KEY;
  if(!key) return { fixture_id:null, league:null, country:null, when_text:null, _debug:{error:"NO_API_FOOTBALL_KEY"} };

  const verbose = Number(process.env.AF_VERBOSE ?? 0) || Number(opts.verbose ?? 0);
  const home  = _norm.normalizeTeam(evt?.home);
  const away  = _norm.normalizeTeam(evt?.away);
  const leagueHint  = _norm.normalizeLeagueHint(evt?.league_hint||"");
  const countryHint = _norm.normalizeCountryHint(evt?.country_hint||"");
  const whenText = _norm.normalizeWhenText(evt?.when_text||"");
  const dateISO  = (whenText||"").slice(0,10);

  if(!home || !away || !dateISO){
    return { fixture_id:null, league:null, country:null, when_text:null,
             _debug:{error:"BAD_INPUT", have:{home:!!home,away:!!away,dateISO}} };
  }

  const th = await findTeamIdBySearch(home, countryHint, key);
  let fx = null;

  if(th?.id){
    fx = await findFixture({ dateISO, homeId: th.id, awayName: away, leagueHint, countryHint, key, verbose });
  }
  if(!fx){
    fx = await findFixtureByDateAll({ dateISO, homeName: home, awayName: away, leagueHint, countryHint, key, verbose });
  }
  if(!fx){
    return { fixture_id:null, league:null, country:null, when_text:dateISO,
             _debug:{ error:"NO_FIXTURE", dateISO, th } };
  }

  const out = {
    fixture_id: String(get(fx,"fixture.id","")) || null,
    league:     String(get(fx,"league.name","")) || null,
    country:    String(get(fx,"league.country","")) || null,
    when_text:  String(get(fx,"fixture.date","")).slice(0,10) || dateISO,
  };
  if(verbose && fx.__match_debug) out._debug = fx.__match_debug;
    DBG({ mode:'final', fixture: out.fixture_id, league: out.league, country: out.country, when_text: out.when_text });
return out;
}

module.exports = { resolveTeamsAndLeague };

// __TEST_EXPORT__ (solo no-produccion)
try { if (process.env.NODE_ENV !== "production") { module.exports.__test__ = { scoreNameMatch }; } } catch(_) {}
