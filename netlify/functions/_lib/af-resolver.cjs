// af-resolver.cjs
// -------------------------------------------------------------
// API-FOOTBALL resolver: búsqueda de fixtures candidatos por nombres
// Mantiene CommonJS. Sin top-level await.
// Requiere: process.env.API_FOOTBALL_KEY (y opcional API_FOOTBALL_BASE)
// -------------------------------------------------------------
'use strict';

const maybeFetch = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');

const BASE = process.env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io';
const KEY  = process.env.API_FOOTBALL_KEY;

if (!KEY) {
  // No lanzamos excepción para no romper el flujo; el caller puede manejar nulls.
  // eslint-disable-next-line no-console
  console.warn('[AF-RESOLVER] Falta API_FOOTBALL_KEY en entorno');
}

/**
 * GET helper con headers de API-FOOTBALL.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getAF(url) {
  const res = await maybeFetch(url, { headers: { 'x-apisports-key': KEY } });
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`[AF-RESOLVER] HTTP ${res.status}: ${txt.slice(0,200)}`);
  }
  return res.json();
}

/**
 * Devuelve lista deduplicada de fixtures candidatos para una ventana temporal.
 * Estructura mínima de cada item:
 * { fixtureId, leagueId, league, country, season, kickoff, home, away }
 * @param {{home:string, away:string, from:string, to:string}} args
 * @returns {Promise<Array>}
 */
async function searchFixturesByNames({ home, away, from, to }) {
  try {
    if (!KEY) return [];
    const hq = encodeURIComponent(String(home||'').trim());
    const aq = encodeURIComponent(String(away||'').trim());

    // 1) Buscar IDs de equipo por nombre (search)
    const [rh, ra] = await Promise.all([
      getAF(`${BASE}/teams?search=${hq}`),
      getAF(`${BASE}/teams?search=${aq}`)
    ]);

    const hIds = (rh?.response || []).map(t => t?.team?.id).filter(Boolean);
    const aIds = (ra?.response || []).map(t => t?.team?.id).filter(Boolean);
    if (!hIds.length || !aIds.length) return [];

    // 2) Traer fixtures por equipo dentro de la ventana temporal y cruzar
    const urlList = [];
    const build = (id) => `${BASE}/fixtures?team=${id}&from=${from}&to=${to}`;
    // Limitamos cada lista a 3 por seguridad (peor caso muchos equipos homónimos)
    hIds.slice(0, 3).forEach(id => urlList.push(build(id)));
    aIds.slice(0, 3).forEach(id => urlList.push(build(id)));
    const uniq = Array.from(new Set(urlList));

    const packs = await Promise.all(uniq.map(u => getAF(u).catch(() => ({ response: [] }))));

    const rows = [];
    for (const p of packs) {
      for (const f of (p.response || [])) {
        rows.push({
          fixtureId: f?.fixture?.id,
          leagueId:  f?.league?.id,
          league:    f?.league?.name,
          country:   f?.league?.country,
          season:    f?.league?.season,
          kickoff:   f?.fixture?.date,
          home:      f?.teams?.home?.name,
          away:      f?.teams?.away?.name
        });
      }
    }

    // 3) Deduplicar por fixtureId
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const k = String(r.fixtureId || '');
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[AF-RESOLVER] Error searchFixturesByNames:', err?.message || err);
    return [];
  }
}

module.exports = { searchFixturesByNames };
