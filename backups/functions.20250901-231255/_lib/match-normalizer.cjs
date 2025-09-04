// netlify/functions/_lib/match-normalizer.cjs
'use strict';

const { normalizeTeamName } = require('./name-normalize.cjs');

function normalizeFixtureNames(evt={}){
  const home = evt.home_team || evt.home || (evt.teams && evt.teams.home && evt.teams.home.name) || '';
  const away = evt.away_team || evt.away || (evt.teams && evt.teams.away && evt.teams.away.name) || '';
  return {
    home_raw: home,
    away_raw: away,
    home: normalizeTeamName(home),
    away: normalizeTeamName(away),
  };
}

module.exports = { normalizeFixtureNames };
