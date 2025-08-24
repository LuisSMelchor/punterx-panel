// netlify/functions/_lib/match-helper.cjs
'use strict';

/**
 * Helper de matching contra API-FOOTBALL con fallback por normalización.
 * - No usa alias fijos ni listas de nombres.
 * - Lee knobs desde match-config.cjs
 */

const { STRICT_MATCH, SIM_THR, TIME_PAD_MIN } = require('./match-config.cjs');
const { normalizeTeamName } = require('./name-normalize.cjs');
const { pickTeamId } = require('./af-resolver.cjs');

function pickEvtName(evt, side){
  return evt?.[side + '_team'] || evt?.[side] || evt?.teams?.[side]?.name || '';
}

async function fetchAFTeamId(name){
  return pickTeamId(name);
}

async function resolveEvent(evt={}, opts={}){
  const home = pickEvtName(evt, 'home');
  const away = pickEvtName(evt, 'away');
  const liga = evt?.league || evt?.league_name || evt?.sport_key || '';
  let homeId = await fetchAFTeamId(home);
  let awayId = await fetchAFTeamId(away);

  // Fallback solo si falta alguno
  if (!homeId || !awayId){
    const nh = normalizeTeamName(home);
    const na = normalizeTeamName(away);
    if (!homeId) homeId = await fetchAFTeamId(nh);
    if (!awayId) awayId = await fetchAFTeamId(na);
    if (process.env.DEBUG_TRACE==='1'){
      console.log('[normalize] raw', { home, away });
      console.log('[normalize] norm', { nh, na, ids: { homeId, awayId } });
    }
  }

  if (homeId && awayId){
    return { ok:true, reason:null, confidence:1, home, away, liga, homeId, awayId };
  }

  return {
    ok:false,
    reason:'sin_team_id',
    confidence:null,
    home, away, liga,
    homeId: homeId || null,
    awayId: awayId || null,
  };
}

module.exports = { resolveEvent, fetchAFTeamId, normalizeTeamName };
