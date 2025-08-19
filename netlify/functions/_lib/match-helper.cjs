// netlify/functions/_lib/match-helper.cjs
// CommonJS — Resolver interno para mapear eventos de OddsAPI → fixture_id de API‑Football
// Estrategia: (1) normalizar nombres → (2) buscar ids de equipos con /teams?search → (3) fixtures por fecha/equipo → cruce de rival

const strip = (s = '') => s
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
  // quitar descriptores comunes y sufijos frecuentes sin amarrarnos a listas rígidas
  .replace(/\b(Futbol Club|Football Club|Sociedad Deportiva|Atletico|Club de Regatas|Sport Club|Esporte Clube|Deportivo|Athletic Club)\b/gi, '')
  .replace(/\b(FC|CF|AC|SC|MG|UANL|CA|EC|ECV|CD)\b/gi, '')
  .replace(/[^\w\s]/g, '') // símbolos
  .replace(/\s+/g, ' ')
  .trim();

const ensureUtcDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.endsWith('Z') ? s : (s + 'Z');
  const d = new Date(iso);
  return isNaN(+d) ? null : d;
};

// Busca ID de equipo en API‑Football por nombre libre (global, sin listas fijas)
async function fetchAFTeamId(afApi, rawName) {
  const q = strip(rawName || '');
  if (!q) return null;
  const r = await afApi('/teams', { search: q }); // API‑Football v3
  const arr = Array.isArray(r?.response) ? r.response : [];
  if (arr.length === 0) return null;

  // Heurística simple pero efectiva: prioriza coincidencias que comienzan igual; luego por longitud más cercana
  const scored = arr.map(x => {
    const nm = (x?.team?.name || '').trim();
    const nmS = strip(nm);
    const starts = nmS.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 0;
    const lenDiff = Math.abs(nmS.length - q.length);
    return { id: x?.team?.id, name: nm, nmS, score: (starts ? 1000 : 0) - lenDiff };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.id || null;
}

/**
 * Resolver principal:
 * @param {Object} evt - evento de OddsAPI (string de equipos + commence_time)
 * @param {Object} ctx - { afApi }
 * @returns {Object} { ok, fixture_id?, league_id?, country?, reason? }
 */
async function resolveTeamsAndLeague(evt, { afApi } = {}) {
  try {
    const home = evt?.home_team || evt?.home || evt?.teams?.home?.name;
    const away = evt?.away_team || evt?.away || evt?.teams?.away?.name;
    const commence = ensureUtcDate(evt?.commence_time || evt?.start_time || evt?.commenceTime);

    if (!home || !away || !commence) {
      console.warn('[MATCH-HELPER] Parametros incompletos en resolveTeamsAndLeague');
      return { ok: false, reason: 'incompleto' };
    }

    const dateYMD = commence.toISOString().slice(0, 10); // YYYY-MM-DD en UTC

    // 1) Resolver team IDs
    const [homeId, awayId] = await Promise.all([
      fetchAFTeamId(afApi, home),
      fetchAFTeamId(afApi, away),
    ]);

    if (!homeId || !awayId) {
      console.warn('[MATCH-HELPER] Sin teamId AF', { homeId, awayId, home, away });
      return { ok: false, reason: 'sin_team_id' };
    }

    // 2) Fixtures del día para el homeId; cruzar rival
    const fx = await afApi('/fixtures', { date: dateYMD, team: homeId, timezone: 'UTC' });
    const list = Array.isArray(fx?.response) ? fx.response : [];
    if (list.length === 0) {
      return { ok: false, reason: 'sin_fixtures_dia' };
    }

    // 3) Cruzar por rival y tolerancia de hora ±120 min vs commence_time
    const tCommence = +commence;
    const TOL = 120 * 60 * 1000; // 120 minutos
    const hit = list.find(x => {
      const fid = x?.fixture?.id;
      const dStr = x?.fixture?.date; // ISO
      const tFx = dStr ? +new Date(dStr) : NaN;
      const hId = x?.teams?.home?.id;
      const aId = x?.teams?.away?.id;
      const rivalOk = (hId === homeId && aId === awayId) || (aId === homeId && hId === awayId);
      const timeOk = isNaN(tFx) ? false : Math.abs(tFx - tCommence) <= TOL;
      return !!fid && rivalOk && timeOk;
    });

    if (!hit?.fixture?.id) {
      return { ok: false, reason: 'sin_fixture_match' };
    }

    return {
      ok: true,
      fixture_id: hit.fixture.id,
      league_id: hit.league?.id || null,
      country: hit.league?.country || null
    };
  } catch (err) {
    console.error('[MATCH-HELPER] resolveTeamsAndLeague error:', err?.message || err);
    return { ok: false, reason: 'exception' };
  }
}

module.exports = {
  resolveTeamsAndLeague,
  fetchAFTeamId,
  strip,
  ensureUtcDate,
};
