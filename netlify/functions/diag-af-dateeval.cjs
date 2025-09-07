'use strict';
const fetch = global.fetch || require('node-fetch');
const norm  = require('./_lib/normalize.cjs');

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

exports.handler = async (event) => {
  try{
    const q = new URLSearchParams(event.queryStringParameters || {});
    const home = String(q.get('home')||'');
    const away = String(q.get('away')||'');
    const league_hint  = String(q.get('league_hint')||q.get('l')||'');
    const country_hint = String(q.get('country_hint')||q.get('c')||'');
    const when_text    = String(q.get('when_text')||q.get('d')||'').slice(0,10);

    const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || process.env.APIFOOTBALL_KEY || '';
    if(!key)  return { statusCode: 500, body: JSON.stringify({ error:'API_FOOTBALL_KEY missing' }) };
    if(!home || !away || !when_text) return { statusCode: 400, body: JSON.stringify({ error:'home, away, when_text required' }) };

    const wantHome   = norm.normalizeTeam(home);
    const wantAway   = norm.normalizeTeam(away);
    const wantLeague = norm.normalizeLeagueHint(league_hint);
    const wantCountry= norm.normalizeCountryHint(country_hint);

    const url = new URL('https://v3.football.api-sports.io/fixtures');
    url.searchParams.set('date', when_text);
    url.searchParams.set('timezone','UTC');

    const r = await fetch(url, { headers: { 'x-apisports-key': key }});
    const j = await r.json().catch(()=> ({}));
    const list = Array.isArray(j && j.response) ? j.response : [];

    const THR = Number(process.env.SIM_THR ?? 0.60);
    const Wl  = Number(process.env.MATCH_LEAGUE_WEIGHT ?? 0.10);
    const Wc  = Number(process.env.MATCH_COUNTRY_WEIGHT ?? 0.10);
    const pen = Number(process.env.AF_BTEAM_PENALTY ?? 0.20);
    const minL= Number(process.env.AF_LEAGUE_MIN_SIM ?? 0); // 0 = no mínimo
    const minC= Number(process.env.AF_COUNTRY_MIN_SIM ?? 0);

    const rows = list.map(it => {
      const hName = it?.teams?.home?.name || '';
      const aName = it?.teams?.away?.name || '';
      const LName = it?.league?.name || '';
      const CName = it?.league?.country || '';
      let sH = scoreNameMatch(wantHome, hName);
      let sA = scoreNameMatch(wantAway, aName);
      const sL = wantLeague ? scoreNameMatch(wantLeague, LName) : 0.5;
      const sC = wantCountry? scoreNameMatch(wantCountry, CName): 0.5;

      // penalización B-team si el candidato parece filial y lo buscado no
      if (pen>0){
        if (isBTeam(hName) && !isBTeam(wantHome)) sH = Math.max(0, sH-pen);
        if (isBTeam(aName) && !isBTeam(wantAway)) sA = Math.max(0, sA-pen);
      }

      const passTeams = (sH >= THR && sA >= THR);
      const passL     = !wantLeague  || sL >= (minL || 0);
      const passC     = !wantCountry || sC >= (minC || 0);
      const score = sH*0.40 + sA*0.40 + sL*Wl + sC*Wc;

      return {
        fixture_id: it?.fixture?.id || null,
        when: (it?.fixture?.date||'').slice(0,19),
        league: LName, country: CName,
        home: hName, away: aName,
        sH: +sH.toFixed(3), sA: +sA.toFixed(3),
        sL: +sL.toFixed(3), sC: +sC.toFixed(3),
        score: +score.toFixed(3),
        pass: { teams: passTeams, league: passL, country: passC }
      };
    }).sort((a,b)=> b.score - a.score);

    return {
      statusCode: 200,
      headers: { 'content-type':'application/json; charset=utf-8' },
      body: JSON.stringify({
        query:{ home,away,league_hint,country_hint,when_text, THR, Wl, Wc, pen, minL, minC },
        count: rows.length,
        top: rows.slice(0, 25)  // top 25 para inspección
      }, null, 2)
    };
  }catch(e){
    return { statusCode: 500, body: String(e && e.stack || e) };
  }
};
