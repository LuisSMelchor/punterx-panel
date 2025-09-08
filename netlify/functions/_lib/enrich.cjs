'use strict';


// [AF_SENTINEL_DBG_V1]
const __AF_DBG__ = !!process.env.AF_DEBUG;
const dlog = (...xs)=>{ if (__AF_DBG__) console.log('[AF_DEBUG]', ...xs); };
// OddsAPI (real) - import tolerante
let fetchOddsForFixture = null;
try {
  const __m = require('./odds-helpers.cjs');
  fetchOddsForFixture = (__m && (__m.fetchOddsForFixture || (__m.default && __m.default.fetchOddsForFixture))) || null;
} catch (_) { fetchOddsForFixture = null; } // __SANE_ENRICH_IMPORT__


/** PIPE ALPHA (opcional): emite snapshots NDJSON desde el lib si EV_PIPE_ALPHA=1 */
function __pipeAlphaMaybe__(payload){
  try{
    if (!process || !process.env || process.env.EV_PIPE_ALPHA!=='1') return;
    const fs = require('fs');
    const EV_MKT = process.env.EV_MKT || '/tmp/_ev.market.ndjson';
    const EV_OUT = process.env.EV_OUT || '/tmp/_ev.decisions.ndjson';

    // helpers seguros
    const normStr = (x)=> (x==null? null : String(x));
    const safeAppend = (file, line) => {
      try { fs.appendFileSync(file, line.endsWith('\n')? line : line+'\n'); } catch(_){}
    };

    // intenta leer campos desde distintas formas de payload o fixture
    const sport = normStr(payload?.match?.sport_key || payload?.evt?.sport_key || payload?.sport || null);
    const key   = normStr(payload?.match?.key || payload?.evt?.key || payload?.evt?.id || payload?.fixture_id || `alpha_${Date.now()}`);
    const start = (payload?.kickoff || payload?.match?.start_iso || payload?.evt?.start_iso || new Date().toISOString());

    // minutesUntil existe arriba; si no, cae en null
    let mins = null; try{ mins = minutesUntil(start); }catch(_){}

    // market snapshot canónico vacío (sin H2H todavía)
    const lineMkt = {
      sport, key, start_iso: start, mins_to_start: mins,
      best_price: { home:null, draw:null, away:null },
      p_mkt: {}
    };

    // línea minimal de decisiones (no activa picks)
    const lineOut = {
      sport, key, start_iso: start, mins_to_start: mins,
      p_mkt: {}, p_model: null, pick: null, status: 'skip_no_h2h'
    };

    // escribe NDJSON
    safeAppend(EV_MKT, JSON.stringify(lineMkt));
    safeAppend(EV_OUT, JSON.stringify(lineOut));
  } catch(_){}
}

/** Wrapper seguro: respeta ausencia de ODDS_API_KEY */
async function __safeFetchOddsForFixture__(fixture){
  try {
    if (!process.env || !process.env.ODDS_API_KEY) return null;
    if (typeof fetchOddsForFixture !== 'function') return null;
    return await fetchOddsForFixture(fixture);
  } catch (_){ return null; }
}



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
  try { dlog("[ENRICH.sport]", __SPORT_KEY); } catch(_){ }
  if (typeof fetchOddsForFixture !== 'function') return null;
  try { return await fetchOddsForFixture(fixture); } catch { return null; }
  try { dlog("[ENRICH.res]", (res && res.status) || res?.statusCode || "(no status)"); } catch(_){}
  try { dlog("[ENRICH.res]", (res && res.status) || res?.statusCode || "(no status)"); } catch(_){}
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
async function ensureMarketsWithOddsAPI({ fixture = {}, oddsRaw = null, payload = {} } = {}) {
  // --- status guard: cuenta mercados antes ---
  payload = payload || {}; payload.meta = (payload.meta && typeof payload.meta==="object") ? payload.meta : {};
  payload.markets = (payload.markets && typeof payload.markets==="object") ? payload.markets : {};
  const __beforeMk = Object.keys(payload.markets).length;
  // -- guards mínimos --
  payload = payload || {}; payload.meta = (payload.meta && typeof payload.meta==="object") ? payload.meta : {};
  try {
    const _k = String(process.env.ODDS_API_KEY||"");
    const _canon = String(process.env.ODDS_MARKETS_CANON||"");
    dlog("[ENRICH.cfg] key=***"+_k.slice(-4)+" canon="+_canon);
  } catch(_) {}
  try {
    const _k = (process.env.ODDS_API_KEY||"");
    const _m = (process.env.ODDS_MARKETS_CANON||"");
    dlog("[ENRICH.cfg] key=***" + _k.slice(-4) + " canon=" + _m);
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
// asegurar puntero seguro
try{ module.exports.fetchOddsForFixture = __safeFetchOddsForFixture__; }catch(_){ }


// === [/* dedup: pruned AUTO-INJECT tail */

// === clean exports (dedup) ===
try{ module.exports.composeOneShotPrompt=composeOneShotPrompt; }catch(_){ }
try{ module.exports.oneShotPayload=oneShotPayload; }catch(_){ }
try{ module.exports.ensureMarketsWithOddsAPI=ensureMarketsWithOddsAPI; }catch(_){ }


// __pipe_alpha_wrap_done__
try{
  const __origEnsure = module.exports && module.exports.ensureMarketsWithOddsAPI;
  if (typeof __origEnsure === 'function'){
    module.exports.ensureMarketsWithOddsAPI = async function(...args){
      const res = await __origEnsure.apply(this, args);
      /* legacy wrap disabled */
      return res;
    };
  }
}catch(_){}


// __pipe_alpha_args_fallback__
try{
  const __maybeWrapped = module.exports && module.exports.ensureMarketsWithOddsAPI;
  if (typeof __maybeWrapped === 'function' && !__maybeWrapped.__pipe_alpha_args_fallback__){
    const __orig2 = __maybeWrapped;
    const __wrapped = async function(...args){
      const res = await __orig2.apply(this, args);
      try {
        // si res es falsy (impl void), usa args[0].payload o el propio args[0]
        const p = res || (args && args[0] && (args[0].payload || args[0])) || null;
        __pipeAlphaMaybe__(p);
      } catch(_){}
      return res;
    };
    __wrapped.__pipe_alpha_args_fallback__ = true;
    module.exports.ensureMarketsWithOddsAPI = __wrapped;
  }
}catch(_){}

try{ module.exports.__pipeAlphaMaybe__ = __pipeAlphaMaybe__; }catch(_){}
