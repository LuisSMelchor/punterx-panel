'use strict';
const https = require('https');

function _get(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: 9000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function _norm(s='') {
  return String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim();
}

// elimina sufijos comunes tipo "FC", "CF", "SC" para comparación
function _stripTeam(s='') {
  return _norm(s).replace(/\b(fc|cf|sc|ac|cd|ud)\b/g,'').replace(/\s+/g,' ').trim();
}

// Mapa rápido de ligas → sport_key
const LEAGUE_MAP = new Map([
  ['la liga', 'soccer_spain_la_liga'],
  ['laliga', 'soccer_spain_la_liga'],
  ['spain la liga', 'soccer_spain_la_liga'],
  ['premier league', 'soccer_epl'],
  ['english premier league', 'soccer_epl'],
  ['serie a', 'soccer_italy_serie_a'],
  ['bundesliga', 'soccer_germany_bundesliga'],
  ['ligue 1', 'soccer_france_ligue_one'],
  ['mls', 'soccer_usa_mls'],
  ['major league soccer', 'soccer_usa_mls'],
  ['eredivisie', 'soccer_netherlands_eredivisie'],
  ['primeira liga', 'soccer_portugal_primeira_liga'],
  ['campeonato brasileiro serie a', 'soccer_brazil_campeonato'],
  ['brasileirao', 'soccer_brazil_campeonato'],
  ['argentina liga profesional', 'soccer_argentina_primera_division'],
  ['liga mx', 'soccer_mexico_liga_mx'],
  ['championship', 'soccer_efl_championship'],
  ['serie b', 'soccer_italy_serie_b'],
  ['segunda division', 'soccer_spain_segunda_division'],
]);

function guessSportKeyFromLeague(league='') {
  return LEAGUE_MAP.get(_norm(league)) || null;
}

async function discoverSportKeyAll(league='') {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  try {
    const list = await _get(`https://api.the-odds-api.com/v4/sports/?all=true&apiKey=${encodeURIComponent(apiKey)}`);
    const target = _norm(league);
    let best = null, bestScore = 0;
    for (const s of (Array.isArray(list) ? list : [])) {
      const name = _norm(`${s.title || ''} ${s.key || ''}`);
      let score = 0;
      for (const part of target.split(/\s+/)) if (part && name.includes(part)) score++;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best?.key || null;
  } catch { return null; }
}

function sameDayUTC(aIso, bIso) {
  try {
    const a = new Date(aIso), b = new Date(bIso);
    return a.getUTCFullYear()===b.getUTCFullYear() && a.getUTCMonth()===b.getUTCMonth() && a.getUTCDate()===b.getUTCDate();
  } catch { return false; }
}

function teamLikeMatch(evt, home, away) {
  const eH = _stripTeam(evt?.home_team || '');
  const eA = _stripTeam(evt?.away_team || '');
  const h = _stripTeam(home), a = _stripTeam(away);
  const ok =
    (eH.includes(h) && eA.includes(a)) ||
    (eH.includes(a) && eA.includes(h)) ||
    (h.includes(eH) && a.includes(eA)) ||
    (a.includes(eH) && h.includes(eA));
  return ok;
}

/**
 * Trae cuotas del evento según {home,away,league,kickoff/commence}
 * Devuelve arreglo [OddsAPI v4]
 */
async function fetchOddsForFixture(fixtureOrEvt = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;

  const home = fixtureOrEvt.home || fixtureOrEvt.home_name || '';
  const away = fixtureOrEvt.away || fixtureOrEvt.away_name || '';
  const league = fixtureOrEvt.league || fixtureOrEvt.league_name || '';
  const kickoff = fixtureOrEvt.kickoff || fixtureOrEvt.commence || fixtureOrEvt.commence_time || null;

  let sport = guessSportKeyFromLeague(league);
  if (!sport) sport = await discoverSportKeyAll(league);
  if (!sport) return null;

  const regions = process.env.ODDS_REGIONS || 'eu,uk,us,au';
  const markets = process.env.ODDS_MARKETS || 'h2h,both_teams_to_score,totals,double_chance';

  const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sport)}/odds?` +
              `apiKey=${encodeURIComponent(apiKey)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=iso`;

  const arr = await _get(url);
  if (!Array.isArray(arr)) return null;

  if (!home || !away || !kickoff) return arr;

  // filtro por equipos (tolerante) y mismo día UTC
  const matches = arr.filter(evt => {
    const teamOk = teamLikeMatch(evt, home, away);
    const dayOk = evt?.commence_time ? sameDayUTC(evt.commence_time, kickoff) : true;
    return teamOk && dayOk;
  });

  return matches.length ? matches : arr;
}

module.exports = {
  fetchOddsForFixture,
  guessSportKeyFromLeague,
};
