// match-helper.cjs
// -------------------------------------------------------------
// Helper para resolver equipos+liga vía API-FOOTBALL con normalización.
// Exporta: resolveTeamsAndLeague
// Elimina WARN "Módulo cargado pero sin resolveTeamsAndLeague válido"
// -------------------------------------------------------------
'use strict';

const { normTeam, fuzzyEq } = require('./match-normalizer.cjs');
const { searchFixturesByNames } = require('./af-resolver.cjs');

/**
 * Logging defensivo sin depender de frameworks externos
 */
const log = {
  info: (...a) => console.log('[MATCH-HELPER]', ...a),
  warn: (...a) => console.warn('[MATCH-HELPER]', ...a)
};

/**
 * Dado home/away y kickoff ISO (UTC), intenta encontrar el fixture y liga en API-FOOTBALL.
 * - Aplica ventana ±36h alrededor del kickoff.
 * - Score por coincidencia de nombres (peso doble) + proximidad temporal (3h).
 * - Devuelve shape canónico para el resto del pipeline.
 *
 * @param {{home:string, away:string, kickoffISO:string}} args
 * @returns {Promise<{
 *  fixtureId:string, leagueId:string, season:number|string,
 *  pais:string, liga:string, kickoff:string
 * }|null>}
 */
async function resolveTeamsAndLeague({ home, away, kickoffISO }) {
  try {
    if (!home || !away || !kickoffISO) {
      log.warn('Parametros incompletos en resolveTeamsAndLeague');
      return null;
    }

    const around = new Date(kickoffISO);
    const from = new Date(around.getTime() - 36 * 3600 * 1000).toISOString();
    const to   = new Date(around.getTime() + 36 * 3600 * 1000).toISOString();

    // 1) Buscar candidatos en AF
    const candidates = await searchFixturesByNames({ home, away, from, to });
    if (!Array.isArray(candidates) || candidates.length === 0) {
      log.warn(`Sin candidatos AF para "${home}" vs "${away}" en ventana`, { from, to });
      return null;
    }

    // 2) Normalizar nombres objetivo
    const tgtH = normTeam(home);
    const tgtA = normTeam(away);

    // 3) Scoring: nombres (peso 2) + proximidad temporal (<=180 min)
    let best = null;
    let bestScore = -1;

    for (const f of candidates) {
      const h = normTeam(f.home);
      const a = normTeam(f.away);
      const nameScore =
        (fuzzyEq(h, tgtH) ? 1 : 0) +
        (fuzzyEq(a, tgtA) ? 1 : 0);

      const dtMin = Math.abs(new Date(f.kickoff).getTime() - around.getTime()) / 60000;
      const timeScore = dtMin <= 180 ? 1 : 0;

      const score = (nameScore * 2) + timeScore; // prioriza coincidencia de nombres
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }

    if (!best || bestScore < 2) {
      // score <2 implica que no coincidieron ambos nombres; evitamos falsos positivos
      log.warn(`Candidatos insuficientes para "${home}" vs "${away}" (score=${bestScore})`);
      return null;
    }

    const out = {
      fixtureId: String(best.fixtureId),
      leagueId:  String(best.leagueId),
      season:    best.season,
      pais:      best.country || '',
      liga:      best.league || '',
      kickoff:   best.kickoff
    };

    if (!out.fixtureId || !out.leagueId) {
      log.warn('Fixture sin IDs suficientes', out);
      return null;
    }

    return out;
  } catch (err) {
    log.warn('Error en resolveTeamsAndLeague:', err?.message || err);
    return null;
  }
}

module.exports = { resolveTeamsAndLeague };
