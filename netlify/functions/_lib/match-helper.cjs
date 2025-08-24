// netlify/functions/_lib/match-helper.cjs
'use strict';

const { normalizeTeamName } = require('./name-normalize.cjs');
const { STRICT_MATCH, SIM_THR, TIME_PAD_MIN } = require('./match-config.cjs');
const { pickTeamId, sim } = require('./af-resolver.cjs');

function resolveTeamsAndLeague(evt = {}, afApi) {
  const home = evt.home || evt.home_team || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away || evt.away_team || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  const league = evt.liga || evt.league || evt.league_name || evt.leagueName || '';

  const commence = evt.commence || evt.commence_time || evt.commenceTime || null;

  if (process.env.DEBUG_TRACE === '1') {
    console.log('[MATCH-HELPER] start resolve', { home, away, league, commence });
  }

  const result = { home, away, league, homeId: null, awayId: null };

  const normH = normalizeTeamName(home);
  const normA = normalizeTeamName(away);

  try {
    result.homeId = pickTeamId(afApi, home) || pickTeamId(afApi, normH);
    result.awayId = pickTeamId(afApi, away) || pickTeamId(afApi, normA);
  } catch (e) {
    if (process.env.DEBUG_TRACE === '1') {
      console.warn('[MATCH-HELPER] pickTeamId error', (e && e.message) || e);
    }
  }

  if (process.env.DEBUG_TRACE === '1') {
    console.log('[MATCH-HELPER] normalized', { normH, normA, ids: { h: result.homeId, a: result.awayId } });
  }

  return result;
}

module.exports = { sim, pickTeamId, resolveTeamsAndLeague };
