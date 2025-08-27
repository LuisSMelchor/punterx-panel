'use strict';

// fetch ponyfill (por si el runtime no trae fetch)
const fetchPony = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({default: f}) => f(...args)));

function pick(obj, keys) { const o={}; for (const k of keys) o[k]=obj?.[k]; return o; }

exports.handler = async (event) => {
  try {
    const sport = process.env.SPORT_KEY || 'soccer_epl';
    const regions = process.env.ODDS_REGIONS || 'us,eu,uk,au';
    const markets = process.env.ODDS_MARKETS || 'h2h,totals,btts';
    const apiKey = process.env.ODDS_API_KEY;

    if (!apiKey) {
      return { statusCode: 200, body: JSON.stringify({ ok:false, reason:'missing-ODDS_API_KEY' }) };
    }

    // 1) listar deportes (sanity)
    const uSports = `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`;
    const rs = await fetchPony(uSports);
    const sportsStatus = rs.status;
    const sportsText = await rs.text().catch(()=>null);

    // 2) odds del deporte elegido
    const uOdds = `https://api.the-odds-api.com/v4/sports/${sport}/odds?regions=${regions}&markets=${markets}&oddsFormat=decimal&dateFormat=iso&apiKey=${apiKey}`;
    const ro = await fetchPony(uOdds);
    const oddsStatus = ro.status;
    const oddsRaw = await ro.text().catch(()=>null);

    let oddsJson = null;
    try { oddsJson = JSON.parse(oddsRaw); } catch {}

    // arma un resumen top3 por mercado del primer evento (si existe)
    let sample = null;
    if (Array.isArray(oddsJson) && oddsJson.length) {
      const ev = oddsJson[0];
      const bookmakers = Array.isArray(ev.bookmakers) ? ev.bookmakers : [];
      const marketsMap = {};
      for (const b of bookmakers) {
        for (const m of (b?.markets||[])) {
          const key = m.key; // 'h2h', 'totals', 'btts', etc.
          for (const o of (m.outcomes||[])) {
            const label = o.name || o.description || o.point || 'sel';
            const price = o.price;
            const book = b.title || b.key;
            marketsMap[key] = marketsMap[key] || [];
            marketsMap[key].push({ book, label, price });
          }
        }
      }
      // ordena desc por price y corta top3
      for (const k of Object.keys(marketsMap)) {
        marketsMap[k].sort((a,b)=> (b.price||0)-(a.price||0));
        marketsMap[k] = marketsMap[k].slice(0,3);
      }
      sample = {
        id: ev.id, sport_key: ev.sport_key, commence_time: ev.commence_time,
        home: ev.home_team, away: ev.away_team,
        markets_top3: marketsMap
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        inputs: { sport, regions, markets },
        sportsStatus,
        sportsSample: sportsText ? sportsText.slice(0,200) : null,
        oddsStatus,
        oddsArrayLen: Array.isArray(oddsJson) ? oddsJson.length : null,
        sample
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok:false, reason:'server-error', error: e?.message || String(e) }) };
  }
};
