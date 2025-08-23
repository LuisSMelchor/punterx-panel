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

// --- Helpers locales de similaridad (no exportados) ---

// Jaro-Winkler (implementación compacta)
function _jaro(a = '', b = '') {
  if (!a || !b) return 0;
  const s1 = a, s2 = b;
  const mDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Match = new Array(s1.length).fill(false);
  const s2Match = new Array(s2.length).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - mDist);
    const end = Math.min(i + mDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Match[j] || s1[i] !== s2[j]) continue;
      s1Match[i] = true; s2Match[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Match[i]) continue;
    while (!s2Match[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
  return jaro;
}

function _jaroWinkler(a = '', b = '', p = 0.1) {
  const j = _jaro(a, b);
  let l = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) l++; else break;
  }
  return j + l * p * (1 - j);
}

// Similaridad por bigramas (Dice)
function _bigramDice(a = '', b = '') {
  if (!a || !b) return 0;
  const grams = s => {
    const g = [];
    for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2));
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.length || !B.length) return 0;
  const setB = new Map();
  B.forEach(x => setB.set(x, (setB.get(x) || 0) + 1));
  let overlap = 0;
  for (const x of A) {
    const c = setB.get(x);
    if (c > 0) { overlap++; setB.set(x, c - 1); }
  }
  return (2 * overlap) / (A.length + B.length);
}

function _simScore(aRaw = '', bRaw = '') {
  const a = strip((aRaw || '').toLowerCase());
  const b = strip((bRaw || '').toLowerCase());
  if (!a || !b) return 0;
  const jw = _jaroWinkler(a, b);
  const dice = _bigramDice(a, b);
  return Math.max(jw, dice);
}

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
process.env.DEBUG_TRACE==='1' && console.log('[MATCH-HELPER] knobs', { TIME_PAD_MIN, SIM_THR });
;process.env.DEBUG_TRACE==='1' && console.log('[MATCH-HELPER] knobs', { TIME_PAD_MIN, SIM_THR });
;(()=>{ try { 
  if (process.env.DEBUG_TRACE === '1') {
}
} catch(_){} })();
;try { if (process.env.DEBUG_TRACE === '1')


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
    let [homeId, awayId] = await Promise.all([
      fetchAFTeamId(afApi, home),
      fetchAFTeamId(afApi, away),
    ]);
    
    if (!homeId || !awayId) {
      
// Fallback de normalización básica antes de avisar "Sin teamId AF"
(() => {
  try {
    const __normalize = (s) => String(s || '')
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(club de futbol|club de fútbol|club deportivo|football club|futbol club|futebol clube|fc|cf|cd|sc|ac|afc|sfc|cfc)\b/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();

    // list: catálogo AF; home/away: nombres de OddsAPI; homeId/awayId: ids encontrados (pueden venir null)
    const __byNorm = new Map((list || []).map(t => [__normalize(t.name), t.id]));
    const __h = __byNorm.get(__normalize(home));
    const __a = __byNorm.get(__normalize(away));

    if (!homeId && __h) homeId = __h;
    if (!awayId && __a) awayId = __a;

    if (homeId && awayId) {
      console.log('[MATCH-HELPER] Normalized match success', { home, away, homeId, awayId });
      return; // éxito: no emitir el warn
    }
  } catch (e) {
    console.warn('[MATCH-HELPER] normalize fallback error:', e && e.message || e);
  }

  // Si no hubo éxito, dejamos el warn original
  console.warn('[MATCH-HELPER] Sin teamId AF', { homeId, awayId, home, away });
})();

      
      // --- Fallback opcional por tiempo + similaridad ---
      if (String(process.env.AF_MATCH_TIME_SIM) === '1') {
        try {
// ±15 min por defecto
          const THRESH = Number(process.env.AF_MATCH_SIM_THRESHOLD || 0.88);   // 0.88 por defecto
          const rFx = await afApi('/fixtures', { date: dateYMD, timezone: 'UTC' }); // Fixtures del día (forzado a UTC)
          const list = Array.isArray(rFx?.response) ? rFx.response : [];

          if (list.length) {
            const t0 = commence.getTime();
            const padMs = TIME_PAD_MIN * 60 * 1000;
            
            // filtra por ventana de tiempo
            const near = list.filter(fx => {
              const dStr = fx?.fixture?.date;
              const d = ensureUtcDate(dStr);
              if (!d) return false;
              const dt = d.getTime();
              return Math.abs(dt - t0) <= padMs;
            });
            console.log('[MATCH-HELPER] Fallback time+sim cand=', near.length, '±', TIME_PAD_MIN, 'min', 'date', dateYMD);
            
            // escoge por mayor score conjunto (home+away) bajo umbral mínimo por lado
            let best = null;
            for (const fx of near) {
              const h = fx?.teams?.home?.name || '';
              const a = fx?.teams?.away?.name || '';
              const scoreH = _simScore(home, h);
              const scoreA = _simScore(away, a);
              const scoreHrev = _simScore(home, a); // por si OddsAPI invirtió local/visita
              const scoreArev = _simScore(away, h);
              
              // caso normal
              let ok = (scoreH >= THRESH && scoreA >= THRESH);
              let sum = scoreH + scoreA;
              
              // caso invertido
              if (!ok && (scoreHrev >= THRESH && scoreArev >= THRESH)) {
                ok = true;
                sum = scoreHrev + scoreArev;
              }
              if (!ok) continue;
              if (!best || sum > best.sum) best = { fx, sum };
            }
            if (best?.fx?.fixture?.id) {
              const hit = best.fx;
              
              try {
                const hName = hit?.teams?.home?.name;
                const aName = hit?.teams?.away?.name;
                console.log('[MATCH-HELPER] Fallback time+sim HIT', { fixture: hit?.fixture?.id, h: hName, a: aName, sum: (typeof best.sum === 'number' ? best.sum.toFixed(3) : best.sum) });


              return {
                ok: true,
                fixture_id: hit.fixture.id,
                league_id: hit.league?.id || null,
                country: hit.league?.country || null,
              };
            }
          }
        } catch (e) {
          console.warn('[MATCH-HELPER] Fallback tiempo+similitud falló', e?.message || e);
        }
      }
      
      // si el fallback está apagado o no hubo match sólido:
      
// Fallback de normalización básica antes de descartar por sin_team_id
try {
  const __normalize = (s) => String(s || '')
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(club de futbol|club de fútbol|club deportivo|football club|futbol club|futebol clube|fc|cf|cd|sc|ac|afc|sfc|cfc)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

  const __byNorm = new Map((list || []).map(t => [__normalize(t.name), t.id]));
  const __h = __byNorm.get(__normalize(home));
  const __a = __byNorm.get(__normalize(away));

  if (!homeId && __h) homeId = __h;
  if (!awayId && __a) awayId = __a;

  if (homeId && awayId) {
    console.log('[MATCH-HELPER] Normalized match success (pre-return)', { home, away, homeId, awayId });
    
console.log('[MATCH-HELPER] Normalized match success (pre-continue)', { home, away, homeId, awayId });
// no retornamos aquí: dejamos que el flujo normal continúe para buscar fixtures del día y fijar fixture_id/league_id/country
}
} catch(e) {
  console.warn('[MATCH-HELPER] normalize fallback error (pre-return):', e && e.message || e);
}
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
