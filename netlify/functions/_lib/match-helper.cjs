// netlify/functions/_lib/match-helper.cjs
'use strict';

const { normalizeTeamName } = require('./name-normalize.cjs');
const { STRICT_MATCH, SIM_THR, TIME_PAD_MIN } = require('./match-config.cjs');
// usamos SOLO funciones del resolver; nada de alias fijos
const {
  searchFixturesByNames,
  resolveFixtureFromList,
  pickTeamId,
  sim,
} = require('./af-resolver.cjs');

/**
 * Resolución dinámica de teams/league SIN nombres fijos:
 * - Normaliza strings (sin diacríticos, sin sufijos de club, etc.).
 * - Busca candidatos en AF por nombres crudos (el módulo ya normaliza internamente).
 * - Selecciona el mejor fixture por similitud y cercanía temporal (SIM_THR, TIME_PAD_MIN).
 * - Fallback: obtiene team IDs con búsqueda por nombre (raw -> norm) SIN alias.
 */
async function resolveTeamsAndLeague(evt = {}, _afApiIgnored) {
  const home =
    evt.home ||
    evt.home_team ||
    (evt.teams && evt.teams.home && evt.teams.home.name) ||
    '';
  const away =
    evt.away ||
    evt.away_team ||
    (evt.teams && evt.teams.away && evt.teams.away.name) ||
    '';
  const liga = evt.liga || evt.league || evt.league_name || evt.leagueName || '';

  const commence =
    evt.commence || evt.commence_time || evt.commenceTime || null;

  // Normalizaciones (para logs y fallback)
  const normH = normalizeTeamName(home);
  const normA = normalizeTeamName(away);

  if (process.env.DEBUG_TRACE === '1') {
    console.log('[MATCH-HELPER] ver mh-2025-08-24g');
    console.log('[MATCH-HELPER] knobs', {
      TIME_PAD_MIN,
      SIM_THR,
      STRICT_MATCH,
    });
    console.log('[MATCH-HELPER] start resolve', {
      home,
      away,
      league: liga,
      commence,
    });
    console.log('[MATCH-HELPER] normalized', {
      normH,
      normA,
      ids: { h: null, a: null },
    });
  }

  // 1) Buscar fixtures candidatos por nombres (sin alias fijos)
  let candidates = [];
  try {
    candidates = await searchFixturesByNames(home, away, {
      leagueHint: liga || undefined, // pista textual solamente
      commence,
    });
  } catch (e) {
    if (process.env.DEBUG_TRACE === '1') {
      console.warn('[MATCH-HELPER] searchFixturesByNames error', e?.message || e);
    }
  }

  // 2) Elegir el mejor candidato dinámicamente
  let best = null;
  try {
    if (Array.isArray(candidates) && candidates.length) {
      best = resolveFixtureFromList(candidates, {
        home,
        away,
        leagueHint: liga || undefined,
        commence,
        simThr: SIM_THR,       // umbral configurable (env)
        timePadMin: TIME_PAD_MIN,
        debug: process.env.DEBUG_TRACE === '1',
      });
    }
  } catch (e) {
    if (process.env.DEBUG_TRACE === '1') {
      console.warn('[MATCH-HELPER] resolveFixtureFromList error', e?.message || e);
    }
  }

  // 3) Si hay fixture consistente, lo devolvemos
  if (best && (best.fixture_id || best.fixtureId)) {
    const payload = {
      ok: true,
      reason: 'fixture_selected',
      confidence: best.score ?? null,
      fixture_id: best.fixture_id || best.fixtureId,
      homeId: best.homeId ?? null,
      awayId: best.awayId ?? null,
      home,
      away,
      liga,
    };
    if (process.env.DEBUG_TRACE === '1') {
      console.log('[MATCH-HELPER] selected', payload);
    }
    return payload;
  }

  // 4) Fallback: obtener team IDs SOLO por búsqueda textual (raw -> norm)
  let homeId = null;
  let awayId = null;
  try {
    homeId = (await pickTeamId(home)) || (await pickTeamId(normH)) || null;
    awayId = (await pickTeamId(away)) || (await pickTeamId(normA)) || null;
  } catch (e) {
    if (process.env.DEBUG_TRACE === '1') {
      console.warn('[MATCH-HELPER] pickTeamId fallback error', e?.message || e);
    }
  }

  const okTeams = Boolean(homeId && awayId);
  const payload = {
    ok: okTeams || (STRICT_MATCH ? false : null),
    reason: okTeams ? 'team_ids_fallback' : 'no_match',
    confidence: null,
    fixture_id: null,
    homeId,
    awayId,
    home,
    away,
    liga,
  };
  if (process.env.DEBUG_TRACE === '1') {
    console.log('[MATCH-HELPER] rsl=', payload);
  }
  return payload;
}

module.exports = { sim, pickTeamId, resolveTeamsAndLeague };
