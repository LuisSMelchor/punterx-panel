'use strict';

// OddsAPI (real) - import tolerante
let fetchOddsForFixture = null;
try {
  ({ fetchOddsForFixture } = require('./odds-helpers.cjs'));
} catch (_) { fetchOddsForFixture = null; }


/** utilidades básicas **/
function minutesUntil(iso) {
  const t = new Date(iso);
  if (Number.isNaN(+t)) return null;
  return Math.round((t - new Date()) / 60000);
}
function pickTop3(offers = []) {
  return [...offers].sort((a,b)=> (b?.price ?? 0) - (a?.price ?? 0)).slice(0,3);
}

/** normalización de mercados **/
function marketKeyCanonical(key='') {
  const k = String(key||'').toLowerCase().trim();
  if (k === 'h2h') return '1x2';
  if (k === 'both_teams_to_score' || k === 'btts') return 'btts';
  if (k === 'doublechance' || k === 'double_chance') return 'doublechance';
  if (k === 'totals') return 'totals';
  return k;
}
function preferredCanonMarkets() {
  const raw = process.env.ODDS_MARKETS_CANON || '1x2,btts,over_2_5,doublechance';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}
function normalizeFromOddsAPIv4(oddsApiArray = []) {
  const out = { markets: {} };
  for (const evt of (Array.isArray(oddsApiArray) ? oddsApiArray : [])) {
    const bms = Array.isArray(evt.bookmakers) ? evt.bookmakers : [];
    for (const bm of bms) {
      const bk = bm?.title || bm?.key || 'Unknown';
      const mkts = Array.isArray(bm.markets) ? bm.markets : [];
      for (const mkt of mkts) {
        const rawKey = mkt?.key || '';
        const canon = marketKeyCanonical(rawKey);
        const outs = Array.isArray(mkt?.outcomes) ? mkt.outcomes : [];
        if (canon !== 'totals') {
          if (!out.markets[canon]) out.markets[canon] = [];
          for (const o of outs) {
            const price = Number(o?.price);
            if (!Number.isFinite(price)) continue;
            out.markets[canon].push({ bookmaker: bk, price, last_update: bm?.last_update || evt?.last_update || null, outcome: o?.name || null });
          }
        } else {
          const point = Number(mkt?.point);
          if (Number.isFinite(point) && Math.abs(point - 2.5) < 1e-6) {
            if (!out.markets['over_2_5']) out.markets['over_2_5'] = [];
            for (const o of outs) {
              const name = String(o?.name || '').toLowerCase().trim();
              if (name === 'over') {
                const price = Number(o?.price);
                if (!Number.isFinite(price)) continue;
                out.markets['over_2_5'].push({ bookmaker: bk, price, last_update: bm?.last_update || evt?.last_update || null, outcome: 'Over 2.5' });
              }
            }
          }
        }
      }
    }
  }
  return out;
}
function normalizeMarketsFlexible(oddsRaw) {
  if (!oddsRaw) return {};
  if (Array.isArray(oddsRaw)) return normalizeFromOddsAPIv4(oddsRaw).markets || {};
  return oddsRaw?.markets || {};
}
function toTop3ByMarket(markets = {}) {
  const allow = new Set(preferredCanonMarkets());
  const out = {};
  for (const [mkt, offers] of Object.entries(markets)) {
    if (!allow.has(mkt)) continue;
    out[mkt] = pickTop3(offers).map(o => ({ bookie: o.bookmaker, price: o.price, last_update: o.last_update }));
  }
  return out;
}

/** helpers de fixture **/
function attachLeagueCountry(fx = {}) {
  const league = fx?.league_name || fx?.league || null;
  const country = fx?.country || fx?.league_country || fx?.country_name || null;
  return league && country ? `${league} (${country})` : (league || null);
}

/** (opcional) traer odds: dejamos stub para no bloquear **/
async function __fetchOddsForFixtureStub__ (/* fixture */) { return null; }

/** enrich principal **/

/** fetch opcional con tolerancia a entorno sin clave */
async function _maybeFetchOdds(fixture) {
  if (!process.env.ODDS_API_KEY) return null;
  var __SPORT_KEY = (typeof __SPORT_KEY!=="undefined" && __SPORT_KEY) || (process.env.SPORT_KEY || process.env.ODDS_SPORT_KEY || "soccer_epl");
  try { console.log("[ENRICH.sport]", __SPORT_KEY); } catch(_){ }
  if (typeof fetchOddsForFixture !== 'function') return null;
  try { return await fetchOddsForFixture(fixture); } catch { return null; }
  try { console.log("[ENRICH.res]", (res && res.status) || res?.statusCode || "(no status)"); } catch(_){}
  try { console.log("[ENRICH.res]", (res && res.status) || res?.statusCode || "(no status)"); } catch(_){}
}

async function enrichFixtureUsingOdds({ fixture, oddsRaw }) {
  const _fixture = fixture || {};
  let _odds = oddsRaw || null;

  // intentar fetch real si no hay odds en entrada
  if (!_odds) { _odds = await _maybeFetchOdds(_fixture); }

  // si no viene odds y hay key, se podría activar fetchOddsForFixture()
  if (!_odds && process.env.ODDS_API_KEY) {
    try { _odds = await fetchOddsForFixture(_fixture); } catch {}
  }

  const marketsFlex = normalizeMarketsFlexible(_odds);
  const markets_top3 = toTop3ByMarket(marketsFlex);

  const mins = minutesUntil(_fixture?.kickoff);
  const when_text = Number.isFinite(mins)
    ? (mins >= 0 ? `Comienza en ${mins} minutos aprox` : `Comenzó hace ${Math.abs(mins)} minutos aprox`)
    : null;

  const league_text = attachLeagueCountry(_fixture);

  return {
    fixture_id: _fixture?.fixture_id ?? null,
    kickoff: _fixture?.kickoff ?? null,
    when_text,
    league: league_text,
    home_id: _fixture?.home_id ?? null,
    away_id: _fixture?.away_id ?? null,
    markets_top3,
  };
}

/** formateadores / payload **/
function formatMarketsTop3(markets = {}) {
  const lines = [];
  for (const [mkt, arr] of Object.entries(markets || {})) {
    const trio = (arr || []).map(o => `${o.bookie} ${o.price}`).join(' | ');
    lines.push(`${mkt}: ${trio}`);
  }
  return lines.join('\n');
}

function buildOneShotPayload({ evt = {}, match = {}, enriched = {} } = {}) {
  return {
    status: 'preview',
    level: 'info',
    evt,
    match,
    enriched,
    markets: enriched?.markets_top3 || {},
    when_text: enriched?.when_text || null,
    league: enriched?.league || match?.league_name || null,
    result_trace: `oneshot-${Date.now().toString(36)}`
  };
}

async function oneShotPayload({ evt = {}, match = {}, fixture = {} }) {
  const enriched = await enrichFixtureUsingOdds({ fixture, oddsRaw: null });
  return buildOneShotPayload({ evt, match, enriched });
}

function composeOneShotPrompt(payload = {}) {
  const lines = [];
  if (payload?.evt?.home && payload?.evt?.away) lines.push(`${payload.evt.home} vs ${payload.evt.away}`);
  if (payload?.league) lines.push(payload.league);
  if (payload?.when_text) lines.push(payload.when_text);
  const mk = formatMarketsTop3(payload?.markets || {});
  if (mk) lines.push('', mk);
  return lines.join('\n');
}

/** exports ÚNICO **/
/** shim: garantiza mercados_top3 desde fixture/oddsRaw **/
async function ensureMarketsWithOddsAPI({ fixture, oddsRaw } = {}) {
  // --- status guard: cuenta mercados antes ---
  payload = payload || {}; payload.meta = (payload.meta && typeof payload.meta==="object") ? payload.meta : {};
  payload.markets = (payload.markets && typeof payload.markets==="object") ? payload.markets : {};
  const __beforeMk = Object.keys(payload.markets).length;
  // -- guards mínimos --
  payload = payload || {}; payload.meta = (payload.meta && typeof payload.meta==="object") ? payload.meta : {};
  try {
    const _k = String(process.env.ODDS_API_KEY||"");
    const _canon = String(process.env.ODDS_MARKETS_CANON||"");
    console.log("[ENRICH.cfg] key=***"+_k.slice(-4)+" canon="+_canon);
  } catch(_) {}
  try {
    const _k = (process.env.ODDS_API_KEY||"");
    const _m = (process.env.ODDS_MARKETS_CANON||"");
    console.log("[ENRICH.cfg] key=***" + _k.slice(-4) + " canon=" + _m);
  } catch(_) {}
  try {
    const enriched = await enrichFixtureUsingOdds({ fixture, oddsRaw });
    return enriched?.markets_top3 || {};
  } catch (_) { return {}; }
}

module.exports = { enrichFixtureUsingOdds,
  fetchOddsForFixture,
  marketKeyCanonical,
  preferredCanonMarkets,
  normalizeFromOddsAPIv4,
  toTop3ByMarket,
  buildOneShotPayload,
  oneShotPayload,
  formatMarketsTop3,
  composeOneShotPrompt, ensureMarketsWithOddsAPI }

// === [AUTO-INJECT] ENRICH WRAP SHIM: idempotente ===
try {
  // 1) Alias si sólo existe ensureMarketsWithOddsAPI2
  if (typeof ensureMarketsWithOddsAPI === 'undefined' &&
      typeof ensureMarketsWithOddsAPI2 === 'function') {
    var ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI2;
  }

  // 2) Envolver una sola vez
  if (typeof ensureMarketsWithOddsAPI === 'function' && !global.__ENRICH_WRAP_ONCE__) {
    const __origEnsure = ensureMarketsWithOddsAPI;
    global.__ENRICH_WRAP_ONCE__ = true;

    ensureMarketsWithOddsAPI = async function (payload, evt) {
      // Guards duros para evitar "payload is not defined"
      payload = payload || {};
      payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
      payload.markets = (payload.markets && typeof payload.markets === 'object') ? payload.markets : {};

      try {
        const out = await __origEnsure(payload, evt);
        return out || payload;
      } catch (e) {
        try {
          payload.meta.enrich_status = payload.meta.enrich_status || 'error';
          payload.meta.enrich_error  = String((e && e.message) || e);
        } catch (_) {}
        return payload;
      }
    };

    // 3) Refrescar export en CommonJS
    try { module.exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI; } catch (_){}
    try { exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI; } catch (_){}
  }
} catch (_) {}
// === [/AUTO-INJECT] ===


// === [AUTO-INJECT] ensureMarketsWithOddsAPI export hotfix (idempotent, clean) ===
try {
  // 1) Alias si sólo existe ensureMarketsWithOddsAPI2
  if (typeof ensureMarketsWithOddsAPI === 'undefined' &&
      typeof ensureMarketsWithOddsAPI2 === 'function') {
    var ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI2;
  }

  // 2) Definición básica si aún no existe
  if (typeof ensureMarketsWithOddsAPI !== 'function') {
    async function ensureMarketsWithOddsAPI(payload = {}, evt = {}) {
      payload = payload || {};
      payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
      payload.markets = (payload.markets && typeof payload.markets === 'object') ? payload.markets : {};
      try {
        const enriched = await enrichFixtureUsingOdds({ fixture: evt || {}, oddsRaw: null });
        const mk = (enriched && enriched.markets_top3) ? enriched.markets_top3 : {};
        if (mk && typeof mk === 'object') {
          payload.markets = Object.assign({}, payload.markets, mk);
        }
      } catch (_) {}
      return payload;
    }
  }

  // 3) Re-export explícito CommonJS
  try { module.exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI; } catch (_){}
  try { exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI; } catch (_){}
} catch (_) {}
// === [/AUTO-INJECT] ===

// === [AUTO-INJECT ensure.wrap.safe.v2] idempotent ===
try {
  // Wrapper que NO llama a la impl. rota; usa enrichFixtureUsingOdds directo
  async function ensureMarketsWithOddsAPI_SAFE(payload = {}, evt = {}) {
    try { payload = payload || {}; } catch(_) { payload = {}; }
    payload.meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
    payload.markets = (payload.markets && typeof payload.markets === 'object') ? payload.markets : {};

    try {
      const enriched = await enrichFixtureUsingOdds({ fixture: evt || {}, oddsRaw: null });
      const mk = (enriched && enriched.markets_top3 && typeof enriched.markets_top3 === 'object')
        ? enriched.markets_top3 : {};
      if (mk && typeof mk === 'object') {
        payload.markets = Object.assign({}, payload.markets, mk);
      }
      payload.meta.enrich_status = payload.meta.enrich_status || 'ok';
      return payload;
    } catch (e) {
      try {
        payload.meta.enrich_status = payload.meta.enrich_status || 'error';
        payload.meta.enrich_error  = String((e && e.message) || e);
      } catch(_) {}
      return payload;
    }
  }

  // Exporta el wrapper seguro como oficial
  try { module.exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI_SAFE; } catch(_){}
  try { exports.ensureMarketsWithOddsAPI = ensureMarketsWithOddsAPI_SAFE; } catch(_){}
} catch(_){}
