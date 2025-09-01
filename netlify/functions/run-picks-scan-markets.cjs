'use strict';

// deps base
const scan = require('./run-picks-scan.cjs');

// fetch helper (node-fetch si no existe global)
let __fetch = null;
module.exports.__fetch = null;
try { const nf = require('node-fetch'); __fetch = nf.default || nf; } catch (e) { __fetch = (typeof fetch === 'function') ? fetch : null; }

// base URL del propio functions host (autodetect, sin depender de ODDS_BASE)
function __resolveFunctionsBase(event) {
  const envBase = (process && process.env && process.env.ODDS_BASE) || "";
  if (envBase && /\/\.netlify\/functions$/.test(envBase)) return envBase;
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h['host'] || `localhost:${process.env.PORT || 4999}`;
  const proto = h['x-forwarded-proto'] || 'http';
  return `${proto}://${host}/.netlify/functions`;
}

const ENRICH_TIMEOUT_MS = Number(process.env.ODDS_ENRICH_TIMEOUT_MS)||2500;
const ENRICH_MAX        = Number(process.env.ODDS_ENRICH_MAX)||10;
const ENRICH_CONC       = Number(process.env.ODDS_ENRICH_CONC)||4;

/* --- simple in-memory cache for enrich --- */
var __ENRICH_CACHE = (globalThis.__ENRICH_CACHE ||= new Map());
var ENRICH_CACHE_TTL_MS = (globalThis.__ENRICH_CACHE_TTL_MS ??= (Number(process.env.ODDS_ENRICH_CACHE_TTL_MS)||60000));
function __stableStringify(x){
  const t = typeof x;
  if (x === null || t === "number" || t === "boolean") return JSON.stringify(x);
  if (t === "string") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(__stableStringify).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(x).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + __stableStringify(x[k])).join(",") + "}";
  }
  return JSON.stringify(null);
}
function __cacheKey(evt){ return __stableStringify(evt||{}); }
function __cacheGet(evt){
  const k = __cacheKey(evt); const it = __ENRICH_CACHE.get(k);
  if (!it) return null;
  const at = (it.at!==undefined)? it.at : (it.t!==undefined? it.t : 0);
  const bm = (it.bm!==undefined)? it.bm : (it.v!==undefined? it.v : it);
  if ((Date.now()-at) > ENRICH_CACHE_TTL_MS) { __ENRICH_CACHE.delete(k); return null; }
  return bm;
}
function __cachePut(evt,bm){ try{ __ENRICH_CACHE.set(__cacheKey(evt), { at: Date.now(), bm }); }catch(_){} }
/* --- /cache --- */

function __withTimeout(ms){
  const ac = (typeof AbortController!=="undefined") ? new AbortController() : null;
  const t = setTimeout(() => { try{ ac&&ac.abort(); }catch(_){} }, ms);
  return {signal: ac?ac.signal:undefined, cancel: () => clearTimeout(t)};
}

async function __withRetry(fn, {retries=2, baseDelay=150} = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) break;
      const sleep = baseDelay * (1 + Math.random()) * (i+1);
      await new Promise(r => setTimeout(r, sleep));
    }
  }
  throw lastErr;
}

// fetch a odds-bookmakers
async function __odds_enrich_fetch(baseUrl, evt) {
    const cached = __cacheGet(evt);
  if (cached != null) { try{ __m_cache_hits++; }catch(_){ } return cached; }
try {
      if (!__fetch || !baseUrl || !evt) return null;
    const u = new URL(baseUrl + "/odds-bookmakers");
    u.searchParams.set("evt", JSON.stringify(evt));
    const doFetch = async () => {
      const ctl = __withTimeout(ENRICH_TIMEOUT_MS);
      try {
        const r = await __fetch(u.toString(), { signal: ctl.signal });
        if (!r || !r.ok) throw new Error(`HTTP ${r && r.status}`);
        const j = await r.json();
          const arr = Array.isArray(j.bookmakers) ? j.bookmakers : null;
          if (arr) { try { __cachePut(evt, arr); } catch(_){ } }
          return arr;} finally { ctl.cancel(); }
    };
    const bm = await __withRetry(doFetch, { retries: 2, baseDelay: 120 });
    if (bm && bm.length) __cachePut(evt, bm);
    return bm;
  } catch (_) { return null; }
}
// handler principal (CJS)
module.exports.handler = async (event, context) => {
  const base = await scan.handler(event, context);
  let payload; try { payload = JSON.parse(base.body||"{}"); } catch { payload = {}; }

  const results = (payload && payload.batch && Array.isArray(payload.batch.results)) ? payload.batch.results : [];
  const functionsBase = __resolveFunctionsBase(event);
  const qs = (event && event.queryStringParameters) || {};
  const START_TS = Date.now();
  const SOFT_BUDGET_MS = Number(process.env.ODDS_ENRICH_SOFT_BUDGET_MS)||8000;
  const DEV_FAST_DEFAULT = String(process.env.DEV_FAST_DEFAULT||"") === "1";
  const fast = String(qs.fast||"")==="1" || DEV_FAST_DEFAULT;
  const maxN = fast ? Math.min(5, Math.max(0, Number(qs.enrich_max||ENRICH_MAX)))
                     : Math.max(0, Number(qs.enrich_max||ENRICH_MAX));
  const conc = Math.max(1, Number(qs.enrich_conc||ENRICH_CONC));
    let __m_cache_hits=0, __m_cache_misses=0, __m_timeouts=0;

// --- ENRICH con límite y concurrencia ---
  let done = 0, ok = 0;
  const tasks = (results||[])
    .filter(it => it && it.evt && !Array.isArray(it.bookmakers))
    .slice(0, maxN)
    .map(it => async () => {
      if ((Date.now() - START_TS) > SOFT_BUDGET_MS) { done++; return; }
      try {
        const bm = await (async () => {
          const cached = __cacheGet(it.evt);
          if (cached != null) { try{ __m_cache_hits++; }catch(_){} return cached; }
          try{ __m_cache_misses++; }catch(_){}
          const u = new URL(functionsBase + "/odds-bookmakers");
          u.searchParams.set("evt", JSON.stringify(it.evt));
          const doFetch = async () => {
            const ctl = __withTimeout(ENRICH_TIMEOUT_MS);
            try {
              const r = await ((module.exports??null)&&module.exports.__fetch||__fetch||fetch)(u.toString(), { signal: ctl.signal });
              if (!r || !r.ok) throw new Error(`HTTP ${r && r.status}`);
              const j = await r.json();
              const arr = Array.isArray(j.bookmakers) ? j.bookmakers : null;
              if (arr) __cachePut(it.evt, arr);
              return arr;
            } finally { try{ctl.cancel();}catch(_){} }
          };
          return await __withRetry(doFetch, { retries: 2, baseDelay: 120 });
        })();
        if (bm && bm.length) { it.bookmakers = bm; ok++; }
      } catch(e) {
        if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) { try{ __m_timeouts++; }catch(_){} }
      } finally { done++; }
    });
  const running = [];
  for (const t of tasks) {
    const p = t().catch(()=>{});
    running.push(p);
    if (running.length >= conc) {
      await Promise.race(running).catch(()=>{});
      running.shift();
    }
  }
  await Promise.allSettled(running);
  // --- /ENRICH ---
  const sum_bm = (results||[]).reduce((n,r)=> n + (Array.isArray(r&&r.bookmakers)?r.bookmakers.length:0), 0);
  payload.__bookmakers_after = (results||[]).filter(r => r && Array.isArray(r.bookmakers) && r.bookmakers.length).length;
  payload.__enrich_dbg = { functionsBase, results_len: results.length, sum_bm, maxN, conc, fast , done, ok };
  payload.__enrich_dbg = Object.assign(payload.__enrich_dbg||{}, { cache_hits: __m_cache_hits, cache_misses: __m_cache_misses, timeouts: __m_timeouts });

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
};

/* test-only exports (no afectan al handler) */
module.exports.__test = {
  __resolveFunctionsBase,
  __withTimeout,
  __withRetry
};

/* extra test/diag exports */
module.exports.__test = Object.assign(module.exports.__test||{}, {
  __cacheSize: () => (typeof __ENRICH_CACHE!=='undefined' ? __ENRICH_CACHE.size : null),
  __clearCache: () => { try { __ENRICH_CACHE.clear(); } catch(_){} }
});
/* test helper to set __fetch */
if (!module.exports.__test) module.exports.__test = {};
module.exports.__test.__setFetch = function(fn){ try { module.exports.__fetch = fn; __fetch = fn; } catch(_){} };


function __getFetch() {
  try { if (module && module.exports && module.exports.__fetch) return module.exports.__fetch; } catch(_) {}
  return (typeof __fetch !== "undefined" && __fetch) || (typeof fetch !== "undefined" ? fetch : undefined);
}
/* ---- robust re-export of __odds_enrich_fetch for tests & runtime ---- */
module.exports.__odds_enrich_fetch = async function __odds_enrich_fetch(baseUrl, evt){
    const __hit = __cacheGet(evt);
  if (__hit != null) { return __hit; }
const hit = (typeof __cacheGet === "function" ? __cacheGet(evt) : null);
  if (hit) { try{ __m_cache_hits++; }catch(_){ } return hit; }

  const fx = (typeof __getFetch==="function"
                ? __getFetch()
                : ((typeof module!=="undefined" && module.exports && module.exports.__fetch) || (typeof __fetch!=="undefined" && __fetch) || (typeof fetch!=="undefined" ? fetch : undefined)));
  if (!fx || !baseUrl || !evt) return null;

  const u = new URL(String(baseUrl).replace(/\/?$/,"") + "/odds-bookmakers");
  u.searchParams.set("evt", JSON.stringify(evt));

  const attempts = 1 + 2; // equivalente a retries:2
  let lastErr;
  for (let i=0; i<attempts; i++){
    const ctl = (typeof __withTimeout==="function" ? __withTimeout(ENRICH_TIMEOUT_MS) : { signal: undefined, cancel(){}} );
    try {
      const r = await fx(u.toString(), { signal: ctl.signal });
      if (!r || !r.ok) throw Object.assign(new Error(`HTTP ${r && r.status}`), { status: r && r.status });
      const j = await r.json();
      const arr = Array.isArray(j.bookmakers) ? j.bookmakers : null;
        if (arr) __cachePut(evt, arr);
      return arr;
    } catch(e){
      lastErr = e;
      // si es Abort/timeout, no seguimos reintentando
      if (e && (e.name==="AbortError" || e.code==="ABORT_ERR")) break;
      // backoff mínimo para test; en runtime real ya hay retry externo
      await new Promise(r => setTimeout(r, 10));
    } finally {
      try { ctl.cancel(); } catch(_){}
    }
  }
  throw lastErr;
};
