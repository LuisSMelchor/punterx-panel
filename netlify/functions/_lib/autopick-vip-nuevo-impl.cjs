// netlify/functions/autopick-vip-nuevo-impl.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–55 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrail inteligente para picks inválidos.
// + Corazonada IA integrada (helpers, cálculo, visualización y guardado en Supabase)
// + Snapshots de cuotas (odds_prev_best) para señal de mercado (lectura y escritura)

'use strict';


const { ensureMarketsWithOddsAPI, oneShotPayload } = require('./enrich.cjs');
/* ============ Blindaje runtime ============ */
try { if (typeof fetch === 'undefined') global.fetch = require('node-fetch'); } catch (_) {}
try {
  process.on('uncaughtException', e => console.error('[UNCAUGHT]', e && (e.stack || e.message || e)));
  process.on('unhandledRejection', e => console.error('[UNHANDLED]', e && (e.stack || e.message || e)));
} catch(e) {}

// netlify/functions/autopick-vip-run2.cjs
let OpenAICtor = null; // se resuelve por import() cuando se necesite
const fs = require('fs');
const path = require('path');
const { afApi, resolveFixtureFromList } = require('./af-resolver.cjs');
// Corazonada (tu módulo ya existente)
const { computeCorazonada } = require('./_corazonada.cjs');
const { createLogger } = require('./_logger.cjs');
const { resolveTeamsAndLeague } = require('./match-helper.cjs');
const OpenAI = require('openai'); // __SANE_OAI_IMPORT__
const { ensureSupabase } = require('./_supabase-client.cjs'); // __SANE_SUPABASE_IMPORT__

// =============== ENV ===============
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  PUNTERX_SECRET,
  AUTH_CODE
} = process.env;

// Regiones para OddsAPI (globales). Prioridad: ODDS_REGIONS > LIVE_REGIONS > default
const ODDS_REGIONS = process.env.ODDS_REGIONS || process.env.LIVE_REGIONS || 'us,uk,eu,au';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const OPENAI_MODEL_FALLBACK = process.env.OPENAI_MODEL_FALLBACK || 'gpt-5';
const LOG_VERBOSE = process.env.LOG_VERBOSE === '1';
const LOG_EVENTS_LIMIT = Number(process.env.LOG_EVENTS_LIMIT || '8'); // top N previos a kickoff en logs

// Clave de deporte para OddsAPI (v4). Mantén global y sin listas fijas.
const SPORT_KEY = process.env.ODDS_SPORT_KEY || 'soccer';

// Flags de auditoría/estricto
const STRICT_MATCH = Number(process.env.STRICT_MATCH || '0') === 1;
const DEBUG_TRACE  = process.env.DEBUG_TRACE === '1';   // trazas detalladas por evento

// Ventanas por defecto: 45–55 (principal) y 35–70 (fallback)
const WINDOW_MAIN_MIN = Number(process.env.WINDOW_MAIN_MIN || 45);
const WINDOW_MAIN_MAX = Number(process.env.WINDOW_MAIN_MAX || 55);
const WINDOW_FB_MIN   = Number(process.env.WINDOW_FB_MIN   || 35);
const WINDOW_FB_MAX   = Number(process.env.WINDOW_FB_MAX   || 70);

// Sub-ventana dentro de la principal para priorizar 45–55 sin cerrar 40–44
const SUB_MAIN_MIN = Number(process.env.SUB_MAIN_MIN || 45);
const SUB_MAIN_MAX = Number(process.env.SUB_MAIN_MAX || 55);

const PREFILTER_MIN_BOOKIES = Number(process.env.PREFILTER_MIN_BOOKIES || 2);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 6);
const MAX_PER_CYCLE = Number(process.env.MAX_PER_CYCLE || 50);
const SOFT_BUDGET_MS = Number(process.env.SOFT_BUDGET_MS || 70000);
const MAX_OAI_CALLS_PER_CYCLE = Number(process.env.MAX_OAI_CALLS_PER_CYCLE || 40);
const COUNTRY_FLAG = process.env.COUNTRY_FLAG || '🇲🇽';

// Corazonada toggle
const CORAZONADA_ENABLED = (process.env.CORAZONADA_ENABLED || '1') !== '0';

// Lookback para oddsPrevBest (minutos)
const ODDS_PREV_LOOKBACK_MIN = Number(process.env.ODDS_PREV_LOOKBACK_MIN || 7);

const LOCK_TABLE = 'px_locks';
const LOCK_KEY_FN = 'autopick_vip_nuevo';

// Tablas
const PICK_TABLE = 'picks_historicos';
const ODDS_SNAPSHOTS_TABLE = 'odds_snapshots'; // nueva tabla para snapshots de cuotas

function getHeaders(event) {
  const h = (event && event.headers) || {};
  const out = {};
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k];
  return out;
}

function isDebug(event) {
  const q = (event && event.queryStringParameters) || {};
  const h = getHeaders(event);
  return q.debug === '1' || h['x-debug'] === '1';
}

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID','ODDS_API_KEY','API_FOOTBALL_KEY'
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ ENV faltantes:', missing.join(', '));
    throw new Error('Variables de entorno faltantes (autopick-live)');
  }
}

/* Helpers de envío (opcional / no-op en preview) */
const SEND_DISABLED = (process.env.SEND_TELEGRAM === '0' || process.env.PUBLISH_PREVIEW_ONLY === '1');
let send = null;
if (!SEND_DISABLED) {
  try { send = require('../send.js'); } catch(_) { /* ignore, fallback below */ }
}
if (!send) {
  // no-op compatible: firma simple que devuelve ack
  send = async function noopSend(/*...args*/) {
    return { ok: true, dry: true, reason: 'send_disabled_or_missing' };
  };
}
/* =============== CLIENTES =============== */
let supabase = null; // __SANE_SUPABASE_INIT__
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Helpers de envío (debes tener netlify/functions/send.js con LIVE FREE/VIP)
catch (e) { throw new Error("No se pudo cargar send.js (helpers LIVE)"); }
}

/* =============== Utils =============== */
const PROB_MIN = 5;   // % mínimo IA
const PROB_MAX = 85;  // % máximo IA
const GAP_MAX  = 15;  // p.p. IA vs implícita
const EV_VIP   = 15;  // % umbral VIP
const EV_FREE0 = 10;  // % umbral FREE informativo

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function safeJson(res){ try { return await res.json(); } catch { return null; } }
async function safeText(res){ try { return await res.text(); } catch { return ""; } }
function nowISO(){ return new Date().toISOString(); }

function impliedProbPct(cuota){
  const c = Number(cuota);
  if (!Number.isFinite(c) || c <= 1.0) return null;
  return +(100 / c).toFixed(2);
}
function calcEV(probPct, cuota){
  const p = Number(probPct)/100, c = Number(cuota);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  return +(((p * c) - 1) * 100).toFixed(2);
}
function minuteBucket(minute){ const m = Math.max(0, Number(minute)||0); return Math.floor(m/5)*5; }
function phaseFromMinute(minute){
  const m = Number(minute)||0;
  if (m <= 15) return "early";
  if (m >= 40 && m <= 50) return "ht";
  if (m >= 75) return "late";
  return "mid";
}
function nivelPorEV(ev){
  const v = Number(ev)||0;
  if (v >= 40) return "🟣 Ultra Élite";
  if (v >= 30) return "🎯 Élite Mundial";
  if (v >= 20) return "🥈 Avanzado";
  if (v >= 15) return "🥉 Competitivo";
  return "📄 Informativo";
}
function normalizeProbPct(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return +(n*100).toFixed(2); // venía 0–1
  return +n.toFixed(2);                   // ya venía en %
}

/* ============ Mapas y normalización de sport keys ============ */
// Map base (tu proyecto) liga → sport_key OddsAPI
const LIGA_TO_SPORTKEY = {
  "Spain - LaLiga": "soccer_spain_la_liga",
  "England - Premier League": "soccer_epl",
  "Germany - Bundesliga": "soccer_germany_bundesliga",
  "Italy - Serie A": "soccer_italy_serie_a",
  "France - Ligue 1": "soccer_france_ligue_one",
  "Netherlands - Eredivisie": "soccer_netherlands_eredivisie",
  "Portugal - Primeira Liga": "soccer_portugal_primeira_liga",
  "USA - MLS": "soccer_usa_mls",
  "UEFA - Champions League": "soccer_uefa_champs_league",
  "UEFA - Europa League": "soccer_uefa_europa_league",
  "South America - Copa Libertadores": "soccer_conmebol_copa_libertadores",
  "South America - Copa Sudamericana": "soccer_conmebol_copa_sudamericana"
};

// Alias para claves antiguas CONMEBOL (compatibilidad hacia atrás)
const SPORT_KEY_ALIASES = {
  "soccer_conmebol_libertadores":  "soccer_conmebol_copa_libertadores",
  "soccer_conmebol_sudamericana":  "soccer_conmebol_copa_sudamericana",
};
const normalizeSportKey = (k) => SPORT_KEY_ALIASES[k] || k;

/* ============ OddsAPI Sports Catalog & helpers ============ */
// Catálogo oficial (no consume cuota) — /v4/sports?all=true (OddsAPI docs) :contentReference[oaicite:2]{index=2}
const ODDS_HOST = "https://api.the-odds-api.com";
const __norm = (s) => String(s||"")
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/\s+/g," ").trim().toLowerCase();

let __sportsCache = null;
async function loadOddsSportsMap(){
  if (__sportsCache) return __sportsCache;
  const url = `${ODDS_HOST}/v4/sports?all=true&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
  const res = await fetch(url);
  if (!res?.ok) {
    console.warn("[OddsAPI] /v4/sports fallo:", res?.status, await safeText(res));
    __sportsCache = { byKey:{}, byTitle:{} };
    return __sportsCache;
  }
  const arr = await res.json().catch(()=>[]);
  const byKey = {}; const byTitle = {};
  for (const s of arr) {
    if (!s?.key) continue;
    byKey[s.key] = s;
    if (s?.title)       byTitle[__norm(s.title)] = s;
    if (s?.description) byTitle[__norm(s.description)] = s;
  }
  __sportsCache = { byKey, byTitle };
  return __sportsCache;
}
function isValidSportKey(k){
  const key = normalizeSportKey(k);
  return Boolean(__sportsCache?.byKey?.[key]);
}
function isActiveSportKey(k){
  const key = normalizeSportKey(k);
  const item = __sportsCache?.byKey?.[key];
  return (typeof item?.active === "boolean") ? item.active : true;
}
async function resolveSportKeyFallback(originalKey){
  try {
    const cache = await loadOddsSportsMap();
    // Si no existe, intenta por títulos conocidos (heurística)
    const candidates = ["libertadores","sudamericana","conmebol"];
    for (const [tNorm, obj] of Object.entries(cache.byTitle)) {
      if (candidates.some(c=> tNorm.includes(c))) return obj.key;
    }
  } catch(e){
    console.warn("[OddsAPI] resolveSportKeyFallback error:", e?.message||e);
  }
  return null;
}

/* ============ Prefiltros: /events (barato) y odds featured ============ */
// /v4/sports/:sport/events (prefiltro 200 + [] cuando no hay fixtures). :contentReference[oaicite:3]{index=3}
async function fetchEvents(sportKey){
  const key = normalizeSportKey(sportKey);
  const url = `${ODDS_HOST}/v4/sports/${encodeURIComponent(key)}/events?apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
  const r = await fetch(url);
  const raw = await safeText(r);
  if (r.status === 404) {
    const err = new Error(`[LIVE] events 404 (sport no encontrado): ${key}`);
    err.code = "UNKNOWN_SPORT";
    err.status = r.status;
    throw err; // 404 ≠ "sin eventos", es "sport inválido" :contentReference[oaicite:4]{index=4}
  }
  if (!r.ok) {
    const err = new Error(`[LIVE] events error ${r.status}: ${raw?.slice?.(0, 200)}`);
    err.code = "EVENTS_ERROR";
    err.status = r.status;
    throw err;
  }
  let body = null;
  try { body = raw ? JSON.parse(raw) : []; } catch { body = []; }
  return Array.isArray(body) ? body : [];
}

// /v4/sports/:sport/odds (featured markets; 404 = sport inválido). :contentReference[oaicite:5]{index=5}
async function fetchOddsFeatured(sportKey, regions, markets){
  const key = normalizeSportKey(sportKey);
  const url = `${ODDS_HOST}/v4/sports/${encodeURIComponent(key)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=unix`;
  const r = await fetch(url);
  const raw = await safeText(r);
  if (r.status === 404) {
    // Intento de fallback vía catálogo (p.ej. claves antiguas)
    console.warn("[OddsAPI] odds 404:", key, "→ fallback por catálogo");
    const alt = await resolveSportKeyFallback(key);
    if (alt && alt !== key) {
      const url2 = `${ODDS_HOST}/v4/sports/${encodeURIComponent(alt)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=unix`;
      const r2 = await fetch(url2);
      if (r2.ok) {
        console.info("[OddsAPI] fallback OK:", key, "→", alt);
        return r2.json();
      }
      console.warn("[OddsAPI] fallback también falló:", alt, r2.status, await safeText(r2));
    }
    const err = new Error(`[LIVE] odds 404 (sport no encontrado): ${key}`);
    err.code = "UNKNOWN_SPORT";
    err.status = 404;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`[LIVE] odds error ${r.status}: ${raw?.slice?.(0, 240)}`);
    err.code = "ODDS_ERROR";
    err.status = r.status;
    throw err;
  }
  let body = null;
  try { body = raw ? JSON.parse(raw) : []; } catch { body = []; }
  return Array.isArray(body) ? body : [];
}

/* ============ OddsAPI — extracción de consenso y top-3 ============ */
function consensusAndTop3FromOddsapiEvent(oddsEvent){
  try {
    const offers = [];
    for (const bk of (oddsEvent?.bookmakers||[])) {
      const bookie = bk.title || "";
      for (const m of (bk.markets||[])) {
        const marketKey = m.key || "";
        for (const o of (m.outcomes||[])) {
          const label = o.name || "";
          const price = Number(o.price);
          if (bookie && marketKey && label && Number.isFinite(price)) {
            offers.push({ market: marketKey, label, price, bookie, point: o.point ?? null });
          }
        }
      }
    }
    if (!offers.length) return null;

    const byKey = new Map();
    for (const o of offers) {
      const k = `${o.market}||${o.label}||${o.point ?? "-"}`.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(o);
    }

    const order = ["h2h","totals","spreads"];
    const keys = Array.from(byKey.keys()).sort((a,b)=>{
      const ma = order.findIndex(m => a.startsWith(m));
      const mb = order.findIndex(m => b.startsWith(m));
      return (ma===-1?99:ma) - (mb===-1?99:mb);
    });

    let best = null, consensus = null, top3 = null;
    for (const k of keys) {
      const arr = byKey.get(k);
      const prices = arr.map(x=>x.price).sort((a,b)=>a-b);
      const mid = Math.floor(prices.length/2);
      const med = prices.length%2 ? prices[mid] : (prices[mid-1]+prices[mid])/2;

      const seen = new Set();
      const uniq = arr.sort((a,b)=>b.price-a.price).filter(x => {
        const b = x.bookie.toLowerCase().trim();
        if (seen.has(b)) return false;
        seen.add(b);
        return true;
      });

      const candidate = uniq[0];
      if (!best || (candidate && candidate.price > best.price)) {
        best = candidate;
        consensus = { market: arr[0].market, label: arr[0].label, price: med, point: arr[0].point ?? null };
        top3 = uniq.slice(0,3);
      }
    }
    if (!best || !consensus) return null;
    const gap_pp = Math.max(0, (impliedProbPct(consensus.price)||0) - (impliedProbPct(best.price)||0));
    return { best, consensus, top3, gap_pp };
  } catch {
    return null;
  }
}

/* ============ IA ============ */
function buildOAI(model, prompt, maxOut=380){
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/i.test(model||"");
  const base = {
    model,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2
  };
  if (modern) base.max_completion_tokens = maxOut; else base.max_tokens = maxOut;
  return base;
}
function extractJSON(text){
  if (!text) return null;
  const t = String(text).replace(/```json|```/gi,"").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a===-1 || b===-1 || b<=a) return null;
  try { return JSON.parse(t.slice(a,b+1)); } catch { return null; }
}
function ensureLiveShape(p){
  if (!p || typeof p !== "object") p = {};
  return {
    analisis_gratuito: p.analisis_gratuito ?? "s/d",
    analisis_vip: p.analisis_vip ?? "s/d",
    apuesta: p.apuesta ?? "",
    apuestas_extra: Array.isArray(p.apuestas_extra) ? p.apuestas_extra : [],
    probabilidad: Number.isFinite(p.probabilidad) ? Number(p.probabilidad) : 0,
    no_pick: p.no_pick === true,
    motivo_no_pick: p.motivo_no_pick ?? ""
  };
}
async function pedirLiveIA(ctx){
  const opciones = (ctx.opciones || []).map((s,i)=> `${i+1}) ${s}`).join("\n");
  const prompt = [
    "Eres un analista EN VIVO. Devuelve SOLO JSON con forma:",
    "{",
    "\"analisis_gratuito\":\"\",",
    "\"analisis_vip\":\"\",",
    "\"apuesta\":\"\",",
    "\"apuestas_extra\":[],",
    "\"probabilidad\":0.0,",
    "\"no_pick\":false,",
    "\"motivo_no_pick\":\"\"",
    "}",
    "Reglas:",
    "- Si no hay valor claro en vivo devuelve {\"no_pick\":true}.",
    "- Si no_pick=false: 'apuesta' DEBE ser EXACTAMENTE una de las opciones listadas.",
    "- 'probabilidad' ∈ [0.05, 0.85].",
    "",
    "Contexto:",
    JSON.stringify({
      partido: ctx.partido,
      minuto: ctx.minuto,
      marcador: ctx.marcador,
      fase: ctx.fase,
      top3: ctx.top3,
      mejor_oferta: ctx.best,
      consenso: ctx.consensus
    }),
    "",
    "opciones_apostables:",
    opciones
  ].join("\n");

  const model = OPENAI_MODEL || "gpt-5-mini";
  const req = buildOAI(model, prompt, 380);
  const completion = await openai.chat.completions.create(req);
  const raw = completion?.choices?.[0]?.message?.content || "";
  const obj = extractJSON(raw) || {};
  return ensureLiveShape(obj);
}

/* ============ Supabase ============ */
// [DEDUP_KEEP] duplicate removed -> const PICK_TABLE = "picks_historicos";

async function alreadySentLive({ fixture_id, minute_bucket }){
  try {
    const { data, error } = await supabase
      .from(PICK_TABLE)
      .select("id")
      .eq("evento", String(fixture_id))
      .eq("tipo_pick", "LIVE")
      .gte("timestamp", new Date(Date.now()-90*60*1000).toISOString()) // últimos 90 min
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}
async function saveLivePick({ fixture_id, liga, pais, equipos, ev, probPct, nivel, texto, apuesta, minuto, fase, marcador, market_point, vigencia_text, isVIP }){
  const entrada = {
    evento: String(fixture_id),
    analisis: texto || "",
    apuesta: apuesta || "",
    tipo_pick: "LIVE",
    liga: `${pais} - ${liga}`,
    equipos,
    ev: Number(ev)||0,
    probabilidad: Number(probPct)||0,
    nivel,
    timestamp: nowISO(),
    is_live: true,
    minute_at_pick: Number(minuto)||0,
    phase: fase || "",
    score_at_pick: marcador || "",
    market_point: market_point ?? null,
    vigencia_text: vigencia_text || ""
  };
  const { error } = await supabase.from(PICK_TABLE).insert([entrada]);
  if (error) { console.error("Supabase insert LIVE:", error.message); return false; }
  return true;
}

/* ============ API-FOOTBALL — fixtures en vivo (minuto, marcador, liga/país) ============ */
async function afLiveFixtures(){
  const url = `https://v3.football.api-sports.io/fixtures?live=all`;
  const res = await fetch(url, { headers: { "x-apisports-key": API_FOOTBALL_KEY }});
  if (!res.ok) { console.warn("[AF] fixtures live error:", res.status, await safeText(res)); return []; }
  const data = await safeJson(res);
  const arr = Array.isArray(data?.response) ? data.response : [];
  return arr.map(x => {
    const f = x.fixture||{}, l = x.league||{}, t = x.teams||{}, g = x.goals||{};
    const minute = Number(f.status?.elapsed)||0;
    return {
      fixture_id: f.id,
      league: l.name || "",
      country: l.country || "",
      teams: `${t.home?.name||"Local"} vs ${t.away?.name||"Visitante"}`,
      home: t.home?.name || "Local",
      away: t.away?.name || "Visitante",
      minute,
      phase: phaseFromMinute(minute),
      score: `${g.home ?? 0} - ${g.away ?? 0}`
    };
  });
}

/* ============ Núcleo LIVE: evaluar evento OddsAPI con AF + IA ============ */
async function evaluateOddsEvent(oddsEvent, afLiveIndex){
  // 1) Prefiltro (OddsAPI)
  const pref = consensusAndTop3FromOddsapiEvent(oddsEvent);
  if (!pref) return;

  const bookiesCount = new Set((oddsEvent.bookmakers||[]).map(b=> (b.title||"").toLowerCase().trim())).size;
  if (bookiesCount < Number(LIVE_MIN_BOOKIES)||3) return;

  if ((pref.gap_pp||0) < Number(LIVE_PREFILTER_GAP_PP)) return;

  // 2) Enriquecer con API-FOOTBALL (match por nombres)
  const home = oddsEvent.home_team || "";
  const away = oddsEvent.away_team || "";
  const key = `${home}||${away}`.toLowerCase();
  const fx = afLiveIndex.get(key);
  if (!fx) return; // sin minuto/score/fase, no seguimos

  // 3) IA live
  const opciones = [`${pref.consensus.market}: ${pref.consensus.label} — cuota ${pref.best.price} (${pref.best.bookie})`];
  const ia = await pedirLiveIA({
    partido: `${home} vs ${away}`,
    minuto: fx.minute,
    marcador: fx.score,
    fase: fx.phase,
    top3: pref.top3,
    best: pref.best,
    consensus: pref.consensus,
    opciones
  });
  if (ia.no_pick) return;

  // 4) Validaciones fuertes
  const probPct = normalizeProbPct(ia.probabilidad);
  if (!(Number.isFinite(probPct) && probPct >= PROB_MIN && probPct <= PROB_MAX)) return;

  const impl = impliedProbPct(pref.best.price) || 0;
  if (Math.abs(probPct - impl) > GAP_MAX) return;

  const ev = calcEV(probPct, pref.best.price);
  if (ev == null) return;

  const isVIP  = ev >= EV_VIP;
  const isFREE = !isVIP && ev >= EV_FREE0 && ev < EV_VIP;
  if (!isVIP && !isFREE) return;

  // Anti-duplicado ligero por fixture (bucket 5')
  const mb = minuteBucket(fx.minute);
  const dup = await alreadySentLive({ fixture_id: fx.fixture_id, minute_bucket: mb });
  if (dup) return;

  // 5) Payloads y envío
  const nivel = nivelPorEV(ev);
  const msg = isVIP
    ? construirMensajeVIP(oddsEvent, ia, probPct, ev, nivel, pref.best, "LIVE")
    : construirMensajeFREE(oddsEvent, ia, probPct, ev, nivel);

  const sent = isVIP ? await send.vip(msg) : await send.free(msg);
  if (!sent) {
    console.warn("Error al enviar mensaje:", sent);
    return;
  }

  // Guardar en Supabase
  try {
    const ok = await saveLivePick({
      fixture_id: oddsEvent.id,
      liga: oddsEvent.league,
      pais: oddsEvent.country,
      equipos: oddsEvent.teams,
      ev,
      probPct,
      nivel,
      texto: ia.analisis_vip,
      apuesta: ia.apuesta,
      minuto: fx.minute,
      fase: fx.phase,
      marcador: fx.score,
      market_point: pref.best.point,
      vigencia_text: `Hasta el min ${Math.max(1, fx.minute+5)}`,
      isVIP
    });
    if (!ok) console.warn("Error al guardar pick en Supabase");
  } catch (e) {
    console.error("Error en guardarPickSupabase:", e?.message || e);
  }
}

// =============== HANDLER ===============
exports.handler = async (event, context) => {
  const __send_report = (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && (typeof message_vip !== 'undefined') && !!message_vip && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && (typeof message_free !== 'undefined') && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})();
try { const q = (event && event.queryStringParameters) || {}; if (q.cron) { q.manual = "1"; delete q.cron; } } catch (e) {}
try {
    const q = (event && event.queryStringParameters) || {};
    const h = (event && event.headers) || {};
    if ((q.debug === "1" || h["x-debug"] === "1") && q.ping === "1") {
      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ send_report: __send_report,
ok:true, stage:"early-ping" }) };
    }
  } catch (e) {
    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ send_report: __send_report,
ok:false, stage:"early-ping-error", err: String(e && (e.message || e)) }) };
  }
// --- IDs / debug / headers ---
  const REQ_ID = (Math.random().toString(36).slice(2,10)).toUpperCase();
  // Blindaje total: no dependemos de helpers en el arranque
  let headers = {};
  let debug = false;
  try {
    const raw = (event && event.headers) ? event.headers : {};
    // normaliza a minúsculas para acceso seguro
    for (const k in raw) headers[k.toLowerCase()] = h[k];
    const q = (event && event.queryStringParameters) ? event.queryStringParameters : {};
    debug = (q.debug === '1') || (headers['x-debug'] === '1');
  } catch (e) {
    console.error(`[${REQ_ID}] early-headers-error`, e);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: __send_report,
ok:false, stage: 'early', req: REQ_ID, error: e?.message || String(e) })
    };
  }

  // --- AUTH temprano ---
  const hdrAuth = (headers['x-auth-code'] || headers['x-auth'] || '').trim();
  const expected = (process.env.AUTH_CODE || '').trim();
  if (expected && hdrAuth !== expected) {
    if (debug) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report,
ok:false, stage: 'auth', req: REQ_ID, error: 'forbidden', reason: 'auth_mismatch' })
      };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // --- BOOT protegido (ENV + clientes) ---
  try {
    assertEnv();
    await ensureSupabase();
    await ensureOpenAI();
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[${REQ_ID}] Boot error:`, e?.stack || msg);
    if (debug) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report,
ok:false, stage: 'boot', req: REQ_ID, error: msg, stack: e?.stack || null })
      };
    }
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: __send_report,
ok:false, stage: 'runtime', req: REQ_ID })
    };
  }

  // --- RUNTIME protegido: TODO el ciclo bajo try/catch global ---
  const tStart = Date.now();
  const logger = createLogger('a' + Math.random().toString(36).slice(2,10));
  const cicloId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

  // Contadores
  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0,
    principal: 0, fallback: 0, af_hits: 0, af_fails: 0,
    sub_45_55: 0, sub_40_44: 0
  };
  const causas = {
    strict_mismatch: 0, no_pick_flag: 0, outcome_invalido: 0, prob_fuera_rango: 0,
    incoherencia_pp: 0, ev_insuficiente: 0, ventana_fuera: 0, duplicado: 0, otros: 0
  };

  let gotLock = false;
  try {
    // === inicio ciclo (logs amigables) ===
    logger.section('CICLO PunterX');
    logger.info('▶️ Inicio ciclo; now(UTC)=', new Date().toISOString());
    console.log(`▶️ CICLO ${cicloId} start; now(UTC)= ${new Date().toISOString()}`);
    console.log(`⚙️ Config ventana principal: ${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);
    try { await upsertDiagnosticoEstado('running', null); } catch (_) {}

    // === lock simple (no dupliques este bloque) ===
    if (global.__punterx_lock) {
      console.warn('LOCK activo → salto ciclo');
      return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
ok:true, skipped:true, reason:'mem_lock' }) };
    }
    global.__punterx_lock = true;

    // === lock distribuido ===
    try {
      gotLock = await acquireDistributedLock(120);
    } catch (e) {
      console.warn('acquireDistributedLock error:', e?.message || e);
      gotLock = false;
    }
    if (!gotLock) {
      console.warn('LOCK distribuido activo → salto ciclo');
      return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
ok:true, skipped:true, reason:'dist_lock' }) };
    }

    // === 1) OddsAPI ===
    const base = 'https://api.the-odds-api.com/v4/sports/' + SPORT_KEY + '/odds';
    const url =
      base +
      '?apiKey=' + encodeURIComponent(ODDS_API_KEY) +
      '&regions=' + encodeURIComponent(ODDS_REGIONS) +
      '&oddsFormat=decimal' +
      '&markets=h2h,totals,spreads';

    const tOdds = Date.now();
    const resOdds = await fetchWithRetry(url, { method:'GET' }, { retries: 1, base: 400 });
    const tOddsMs = Date.now() - tOdds;
    if (!resOdds || !resOdds.ok) {
      console.error('OddsAPI error:', resOdds?.status, await safeText(resOdds));
      return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
ok: false, reason:'oddsapi' }) };
    }
    const eventos = await safeJson(resOdds) || [];
    resumen.recibidos = Array.isArray(eventos) ? eventos.length : 0;
    console.log(`ODDSAPI ok=true count=${resumen.recibidos} ms=${tOddsMs}`);

    if (process.env.LOG_VERBOSE === '1') {
      const near = (Array.isArray(eventos) ? eventos : [])
        .map(ev => {
          const t = Date.parse(ev.commence_time);
          const mins = Math.round((t - Date.now()) / 60000);
          const home = ev.home_team || (ev.teams && ev.teams.home && ev.teams.home.name) || '—';
          const away = ev.away_team || (ev.teams && ev.teams.away && ev.teams.away.name) || '—';
          return { mins, label: `${home} vs ${away}` };
        })
        .filter(x => Number.isFinite(x.mins))
        .sort((a,b) => a.mins - b.mins)
        .slice(0, 8);
      near.forEach(n => console.log(`⏱️ ${n.mins}m → ${n.label}`));
    }

    // === 2) normalizar / filtrar ventana ===
    const eventosUpcoming = (eventos || []).filter(ev => {
      const t = Date.parse(ev.commence_time);
      return Number.isFinite(t) && t > Date.now();
    });
    const partidos = eventosUpcoming.map(normalizeOddsEvent).filter(Boolean);

    const inWindow = partidos.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      const principal = m >= WINDOW_MAIN_MIN && m <= WINDOW_MAIN_MAX;
      const fallback  = !principal && m >= WINDOW_FB_MIN && m <= WINDOW_FB_MAX;
      const dentro = principal || fallback;
      if (!dentro) causas.ventana_fuera++;
      return dentro;
    });

    const principalCount = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return m >= WINDOW_MAIN_MIN && m <= WINDOW_MAIN_MAX;
    }).length;
    const fallbackCount = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return !(m >= WINDOW_MAIN_MIN && m <= WINDOW_MAIN_MAX) && (m >= WINDOW_FB_MIN && m <= WINDOW_FB_MAX);
    }).length;

    resumen.enVentana = inWindow.length;
    resumen.principal = principalCount;
    resumen.fallback  = fallbackCount;
    resumen.sub_45_55 = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return m >= SUB_MAIN_MIN && m <= SUB_MAIN_MAX;
    }).length;
    resumen.sub_40_44 = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return m >= WINDOW_MAIN_MIN && m < SUB_MAIN_MIN;
    }).length;

    console.log(
      `📊 Filtrado (OddsAPI): Principal=${principalCount} (45–55=${resumen.sub_45_55}, ${WINDOW_MAIN_MIN}–${SUB_MAIN_MIN-1}=${resumen.sub_40_44}) | ` +
      `Fallback=${fallbackCount} | Total EN VENTANA=${inWindow.length} | Eventos RECIBIDOS=${resumen.recibidos}`
    );

    if (!inWindow.length) {
      console.log('OddsAPI: sin partidos en ventana');
      try {
        const nearest = (Array.isArray(eventos) ? eventos : [])
          .map(ev => ({ t: Date.parse(ev.commence_time), home: ev.home_team || ev?.teams?.home?.name, away: ev.away_team || ev?.teams?.away?.name }))
          .filter(x => Number.isFinite(x.t) && x.t > Date.now())
          .map(x => ({ mins: Math.round((x.t - Date.now())/60000), label: `${x.home||'—'} vs ${x.away||'—'}` }))
          .sort((a,b) => a.mins - b.mins)[0];
        if (nearest) console.log(`[ventana] Próximo fuera de rango: ~${nearest.mins}m → ${nearest.label}`);
      } catch(e) {}
      return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
ok:true, resumen }) };
    }

    // === 3) prefiltro y procesado ===
    const candidatos = inWindow.sort((a,b) => scorePreliminar(b) - scorePreliminar(a)).slice(0, MAX_PER_CYCLE);
    resumen.candidatos = candidatos.length;

    let afHits = 0, afFails = 0;
    for (const P of candidatos) {
      const traceEvt = `[evt:${P.id}]`;
      const abortIfOverBudget = () => { if (Date.now() - tStart > SOFT_BUDGET_MS) throw new Error('Soft budget excedido'); };
      try {
        abortIfOverBudget();

        // Resolver fixture
        try {
          const rsl = await resolveTeamsAndLeague(
            { home: P.home, away: P.away, commence_time: P.commence_time, liga: P.liga || P.sport_title || '' },
            { afApi }
          );
          
// __RSL_LOG_MARK__
if (DEBUG_TRACE) console.log(`${traceEvt} rsl=`, {
  ok: rsl.ok,
  reason: rsl.reason || null,
  confidence: (typeof rsl.confidence === "number" ? rsl.confidence : null),
  home: P.home, away: P.away, liga: P.liga || P.sport_title || ""
});

// confidence gate (umbral configurable)
{
  const THRESH = parseFloat(process.env.MATCH_RESOLVE_CONFIDENCE || '0');
  if (rsl.ok && THRESH > 0 && typeof rsl.confidence === 'number' && rsl.confidence < THRESH) {
    if (DEBUG_TRACE) console.log(`${traceEvt} MATCH bajo umbral → confidence=${rsl.confidence} < ${THRESH}; forzando fallback`);
    rsl.ok = false; // deja pasar al fallback que ya añadimos
  }
}
let infoFromStrict = null;
if (!rsl.ok) {
  const infoTry = await enriquecerPartidoConAPIFootball(P);
  if (infoTry && infoTry.fixture_id) {
    infoFromStrict = infoTry; // usarlo más abajo
    if (DEBUG_TRACE) console.log(`${traceEvt} STRICT_MATCH fallback OK`, JSON.stringify({ fixture_id: infoTry.fixture_id, conf: infoTry.confidence || null }));
  } else {
    causas.strict_mismatch++;
    console.warn(`${traceEvt} STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO (${rsl.reason})`);
    continue;
  }
} else {
  infoFromStrict = {
    fixture_id: rsl.fixture_id,
    league_id: rsl.league_id,
    country: rsl.country
  };
}

          if (infoFromStrict) {
  P.af_fixture_id = infoFromStrict.fixture_id;
  P.af_league_id  = infoFromStrict.league_id;
  P.af_country    = infoFromStrict.country;
} else {
  P.af_fixture_id = rsl.fixture_id;
  P.af_league_id  = rsl.league_id;
  P.af_country    = rsl.country;
}
console.log(`${traceEvt} MATCH OK → fixture_id=${P.af_fixture_id} | league=${P.af_league_id} | country=${P.af_country} | via=${infoFromStrict ? fallback : direct}`);
        } catch (er) {
          console.warn(`${traceEvt} resolveTeamsAndLeague error:`, er?.message || er);
          continue;
        }

        // Enriquecimiento
        const info = infoFromStrict || (await enriquecerPartidoConAPIFootball(P) || {});
        if (info && info.fixture_id) {
          afHits++;
          if (DEBUG_TRACE) {
            console.log('TRACE_MATCH', JSON.stringify({ ciclo: cicloId, odds_event_id: P.id, fixture_id: info.fixture_id, liga: info.liga || P.liga || null, pais: info.pais || P.pais || null }));
          }
        } else {
          afFails++;
          if (DEBUG_TRACE) {
            console.log('TRACE_MATCH', JSON.stringify({ ciclo: cicloId, odds_event_id: P.id, _skip: 'af_no_match', home: P.home, away: P.away, liga: P.liga || null }));
          }
          if (STRICT_MATCH && !(info && info.fixture_id)) {
            causas.strict_mismatch++;
            logger.warn('STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO');
            continue;
          }
        }
        if (info && typeof info === 'object') {
          if (info.pais) P.pais = info.pais;
          if (info.liga) P.liga = info.liga;
        }

        // Memoria + prompt + OpenAI
        const memoria = await obtenerMemoriaSimilar(P);
        const prompt = construirPrompt(P, info, memoria);

        let pick, modeloUsado = OPENAI_MODEL;   // asegúrate de tener OPENAI_MODEL arriba
        try {
          const r = await obtenerPickConFallback(prompt);
          pick = r.pick; modeloUsado = r.modeloUsado;
          console.log(traceEvt, '🔎 Modelo usado:', modeloUsado);
          resumen.oai_calls = (global.__px_oai_calls || 0);
          if (esNoPick(pick)) { causas.no_pick_flag++; console.log(traceEvt, '🛑 no_pick=true →', pick?.motivo_no_pick || 's/d'); continue; }
          if (!pickCompleto(pick)) { console.warn(traceEvt, 'Pick incompleto tras fallback'); continue; }
        } catch (e) {
          console.error(traceEvt, 'Error GPT:', e?.message || e); continue;
        }

        // Cuota del mercado seleccionado
        const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
        if (!cuotaSel || !cuotaSel.valor) { causas.outcome_invalido++; console.warn(traceEvt, 'No se encontró cuota del mercado solicitado → descartando'); continue; }
        const cuota = Number(cuotaSel.valor);

        // Coherencias y EV
        const outcomeTxt = String(cuotaSel.label || P?.marketsBest?.h2h?.label || '');
        if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, P.home, P.away)) { console.warn(traceEvt, '❌ Inconsistencia apuesta/outcome → descartando'); continue; }

        const probPct = estimarlaProbabilidadPct(pick);
        if (probPct == null) { console.warn(traceEvt, '❌ Probabilidad ausente → descartando pick'); continue; }
        if (probPct < 5 || probPct > 85) { causas.prob_fuera_rango++; console.warn(traceEvt, 'Probabilidad fuera de rango [5–85] → descartando'); continue; }

        const imp = impliedProbPct(cuota);
        if (imp != null && Math.abs(probPct - imp) > 15) { causas.incoherencia_pp++; console.warn(traceEvt, `❌ Probabilidad inconsistente (model=${probPct}%, implícita=${imp}%) → descartando`); continue; }

        const ev = calcularEV(probPct, cuota);
        if (ev == null) { console.warn(traceEvt, 'EV nulo'); continue; }
        resumen.procesados++;
        if (ev < 10) { causas.ev_insuficiente++; resumen.descartados_ev++; console.log(traceEvt, `EV ${ev}% < 10% → descartado`); continue; }

        // Snapshot NOW + prev
        try {
          const marketForSnap = mapMarketKeyForSnapshotFromApuesta(pick.apuesta);
          const outcomeLabelForSnap = String(pick.apuesta || '');
          const bestBookie = (Array.isArray(cuotaSel?.top3) && cuotaSel.top3[0]?.bookie) ? String(cuotaSel.top3[0].bookie) : null;
          await saveOddsSnapshot({
            event_key: P.id,
            fixture_id: info?.fixture_id || null,
            market: marketForSnap,
            outcome_label: outcomeLabelForSnap,
            point: (cuotaSel.point != null) ? cuotaSel.point : null,
            best_price: cuota,
            best_bookie: bestBookie,
            top3_json: Array.isArray(cuotaSel?.top3) ? cuotaSel.top3 : null
          });
        } catch (e) { console.warn(traceEvt, '[SNAPSHOT] NOW warn:', e?.message || e); }

        // Corazonada IA
        let cz = { score: 0, motivo: '' };
        try {
          if (CORAZONADA_ENABLED) {
            const side = inferPickSideFromApuesta(pick.apuesta);
            const market = inferMarketFromApuesta(pick.apuesta);
            const oddsNowBest = (cuotaSel && Number(cuotaSel.valor)) || null;
            const oddsPrevBest = await getPrevBestOdds({
              event_key: P.id,
              market: mapMarketKeyForSnapshotFromApuesta(pick.apuesta),
              outcome_label: String(pick.apuesta || ''),
              point: (cuotaSel.point != null) ? cuotaSel.point : null,
              lookbackMin: ODDS_PREV_LOOKBACK_MIN
            });
            const xgStats = buildXgStatsFromAF(info);
            const availability = buildAvailabilityFromAF(info);
            const context = buildContextFromAF(info);
            const cora = computeCorazonada({
              pick: { side, market },
              oddsNow: { best: oddsNowBest },
              oddsPrev: { best: oddsPrevBest },
              xgStats, availability, context
            });
            cz = { score: cora?.score || 0, motivo: String(cora?.motivo || '').trim() };
          }
        } catch (e) { console.warn(traceEvt, '[Corazonada] excepción:', e?.message || e); }

        // Envío VIP/FREE
        const nivel = clasificarPickPorEV(ev);
        const cuotaInfo = { ...cuotaSel, top3: top3ForSelectedMarket(P, pick.apuesta) };
        const destinoVIP = (ev >= 15);

        if (destinoVIP) {
          resumen.intentos_vip++;
          const msg = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo, info, cz);
          const ok = await enviarVIP(msg);
          // === SNAPSHOT ODDS (para CLV) ===
          const snapshot_odds = {
            ts_sent: Date.now(),
            market: pick.market_key || pick.market || null,
            selection: pick.selection_key || pick.selection || null,
            bookmaker_best: pick.best_bookmaker || pick.bookmaker || null,
            price_sent: Number(pick.best_price || pick.price || 0) || null
          };
          if (ok) { resumen.enviados_vip++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuotaInfo, "VIP", cz, snapshot_odds); }
          const topBookie = (cuotaInfo.top3 && cuotaInfo.top3[0]?.bookie) ? `${cuotaInfo.top3[0].bookie}@${cuotaInfo.top3[0].price}` : `cuota=${cuotaSel.valor}`;
          console.log(ok ? `${traceEvt} ✅ Enviado VIP | fixture=${info?.fixture_id || 'N/D'} | ${topBookie}` : `${traceEvt} ⚠️ Falló envío VIP`);
        } else {
          resumen.intentos_free++;
          const msg = construirMensajeFREE(P, pick, probPct, ev, nivel, cz);
          const ok = await enviarFREE(msg);
          // === SNAPSHOT ODDS (para CLV) ===
          const snapshot_odds = {
            ts_sent: Date.now(),
            market: pick.market_key || pick.market || null,
            selection: pick.selection_key || pick.selection || null,
            bookmaker_best: pick.best_bookmaker || pick.bookmaker || null,
            price_sent: Number(pick.best_price || pick.price || 0) || null
          };
          if (ok) { resumen.enviados_free++; await guardarPickSupabase(P, pick, probPct, ev, nivel, null, "FREE", cz, snapshot_odds); }
          console.log(ok ? `${traceEvt} ✅ Enviado FREE | fixture=${info?.fixture_id || 'N/D'} | cuota=${cuotaSel.valor}` : `${traceEvt} ⚠️ Falló envío FREE`);
        }
      } catch (e) {
        console.error(traceEvt, 'Error en loop de procesamiento:', e?.message || e);
      }
    }

    resumen.af_hits = afHits; resumen.af_fails = afFails;
    return { statusCode: 200, body: JSON.stringify({ send_report: __send_report,
ok:true, resumen }) };

  } catch (e) {
    // <<< AQUÍ ATRAPAMOS CUALQUIER 500 DEL RUNTIME >>>
    const msg = e?.message || String(e);
    console.error(`[${REQ_ID}] Runtime error:`, e?.stack || msg);
    if (debug) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send_report: __send_report,
ok:false, stage:'runtime', req:REQ_ID, error: msg, stack: e?.stack || null })
      };
    }
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ send_report: __send_report,
ok:false, stage:'runtime', req: REQ_ID })
    };
  } finally {
    // liberar lock / estado / logs
    try { await releaseDistributedLock(); } catch (_) {}
    global.__punterx_lock = false;
    try { await upsertDiagnosticoEstado('idle', null); } catch (_) {}
    logger.section('Resumen ciclo');
    logger.info('Conteos:', JSON.stringify(resumen));
    logger.info('Causas de descarte:', JSON.stringify(causas));
    const topCausas = Object.entries(causas).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}:${v}`).join(' | ');
    logger.info('Top causas:', topCausas || 'sin descartes');
    console.log(`🏁 Resumen ciclo: ${JSON.stringify(resumen)}`);
    console.log(`Duration: ${(Date.now()-tStart).toFixed(2)} ms...Memory Usage: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
  }
};

// =============== PRE-FILTER & SCORING ===============
function scorePreliminar(p) {
  let score = 0;

  // Diversidad de bookies y mercados presentes
  const set = new Set([
    ...(p.marketsOffers?.h2h||[]),
    ...(p.marketsOffers?.totals_over||[]),
    ...(p.marketsOffers?.totals_under||[]),
    ...(p.marketsOffers?.spreads||[])
  ].map(x => (x?.bookie||"").toLowerCase()).filter(Boolean));
  if (set.size >= PREFILTER_MIN_BOOKIES) score += 20;

  const hasH2H   = (p.marketsOffers?.h2h||[]).length > 0;
  const hasTotals= (p.marketsOffers?.totals_over||[]).length > 0 && (p.marketsOffers?.totals_under||[]).length > 0;
  const hasSpread= (p.marketsOffers?.spreads||[]).length > 0;
  if (hasH2H)    score += 15;
  if (hasTotals) score += 10;
  if (hasSpread) score += 5;

  // Prioridad temporal dentro de la ventana principal
  const mins = Number(p.minutosFaltantes);
  if (Number.isFinite(mins) && mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX) {
    score += 10;
    if (mins >= SUB_MAIN_MIN && mins <= SUB_MAIN_MAX) {
      score += 5;
    }
  }
  return score;
}

// =============== API-FOOTBALL (Info extra) ===============
async function enriquecerPartidoConAPIFootball(partido) {
  try {
    if (!partido?.home || !partido?.away) {
      console.warn(`[evt:${partido?.id}] Sin equipos → skip enriquecimiento`);
      return {};
    }

    // --- Helpers locales
    const sportTitle = String(partido?.sport_title || partido?.liga || "").trim();
    const afLeagueId = null; // sin mapeos estáticos; el resolver dinámico decide
    const kickoffMs = Date.parse(partido.commence_time || "") || Date.now();
    const day = 24 * 3600 * 1000;

    const norm = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(f\.?c\.?|c\.?f\.?|s\.?c\.?|a\.?c\.?|u\.?d\.?|cd|afc|cf|sc|club|deportivo|the|los|las|el|la|de|do|da|unam)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const homeN = norm(partido.home);
    const awayN = norm(partido.away);

    const tok = (s) => norm(s).split(/\s+/).filter(Boolean);

    function nameScore(target, candidate) {
      const t = tok(target), c = tok(candidate);
      if (!t.length || !c.length) return 0;
      const setT = new Set(t), setC = new Set(c);
      const inter = [...setT].filter(x => setC.has(x)).length;
      const union = new Set([...setT, ...setC]).size;
      let j = union ? inter / union : 0;
      if (norm(target) === norm(candidate)) j += 1;
      if (norm(candidate).includes(norm(target)) || norm(target).includes(norm(candidate))) j += 0.25;
      return j;
    }

    function fixtureScore(fx, homeName, awayName) {
      const th = fx?.teams?.home?.name || "";
      const ta = fx?.teams?.away?.name || "";
      try {
      const direct = nameScore(homeName, th) + nameScore(awayName, ta);
      const swapped = nameScore(homeName, ta) + nameScore(awayName, th);
      const dt2 = Date.parse(fx?.fixture?.date || "");
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error search:`, e?.message || e);
    }
    }

    // === 4) ÚLTIMO RECURSO: IDs equipos & H2H ±2d
    try {
      const from = new Date(kickoffMs - 2 * day).toISOString().slice(0, 10);
      const to = new Date(kickoffMs + 2 * day).toISOString().slice(0, 10);
      const fetchTeamId = async (name) => {
        const u = `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(name)}`;
        const r = await fetchWithRetry(u, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
        if (!r?.ok) return null;
        const j = await safeJson(r);
        const items = Array.isArray(j?.response) ? j.response : [];
        if (!items.length) return null;
        const target = norm(name);
        const win = items.map(x => {
          const nm = x?.team?.name || "";
          return { id: x?.team?.id, score: (target === norm(nm)) ? 2 : (norm(nm).includes(target) || target.includes(norm(nm)) ? 1 : 0) };
        }).sort((a, b) => b.score - a.score)[0];
        return win?.id || items[0]?.team?.id || null;
      };

      const th = await fetchTeamId(partido.home);
      const ta = await fetchTeamId(partido.away);

      if (th && ta) {
        const fu = `https://v3.football.api-sports.io/fixtures?h2h=${th}-${ta}&from=${from}&to=${to}&timezone=UTC`;
        const fr = await fetchWithRetry(fu, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
        if (fr?.ok) {
          const fj = await safeJson(fr);
          const fa = Array.isArray(fj?.response) ? fj.response : [];
          fa.sort((a, b) => Math.abs(Date.parse(a?.fixture?.date || 0) - kickoffMs) - Math.abs(Date.parse(b?.fixture?.date || 0) - kickoffMs));
          const fx = fa[0];
          if (fx) {
            return {
              liga: fx?.league?.name || sportTitle || null,
              pais: fx?.league?.country || null,
              fixture_id: fx?.fixture?.id || null,
              fecha: fx?.fixture?.date || null,
              estadio: fx?.fixture?.venue?.name || null,
              ciudad: fx?.fixture?.venue?.city || null,
              arbitro: fx?.fixture?.referee || null,
              weather: fx?.fixture?.weather || null,
              xg: null, availability: null
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error H2H ±2d:`, e?.message || e);
    }

    console.warn(`[evt:${partido?.id}] Sin coincidencias en API-Football`);
    return {};
  } catch (e) {
    console.error(`[evt:${partido?.id}] Error enriquecerPartidoConAPIFootball:`, e?.message || e);
    return {};
  }
}

// =============== MEMORIA (Supabase) ===============
async function obtenerMemoriaSimilar(partido) {
  try {
    const { data, error } = await supabase
      .from(PICK_TABLE)
      .select('evento, analisis, apuesta, tipo_pick, liga, equipos, ev, probabilidad, nivel, timestamp')
      .order('timestamp', { ascending: false })
      .limit(30);
    if (error) { console.error('Supabase memoria error:', error.message); return []; }
    const rows = Array.isArray(data) ? data : [];

    const liga = (partido?.liga || '').toLowerCase();
    const home = (partido?.home || '').toLowerCase();
    const away = (partido?.away || '').toLowerCase();

    const out = [];
    for (const r of rows) {
      const lg = (r?.liga || '').toLowerCase();
      const eq = (r?.equipos || '').toLowerCase();
      const okLiga = liga && lg && (lg.includes(liga.split('—')[0].trim()) || lg.includes(liga.split('-')[0].trim()));
      const okHome = home && eq && eq.includes(home);
      const okAway = away && eq && eq.includes(away);
      if (!okLiga) continue;
      if (okHome || okAway) {
        out.push({
          analisis: r.analisis,
          apuesta: r.apuesta,
          liga: r.liga,
          equipos: r.equipos,
          ev: Number(r.ev),
          probabilidad: Number(r.probabilidad),
          nivel: r.nivel
        });
      }
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) {
    console.error('Supabase memoria exception:', e?.message || e);
    return [];
  }
}

// =============== OAI PROB & UTILS ===============
function estimarlaProbabilidadPct(pick) {
  if (typeof pick.probabilidad === 'undefined') return null;
  const v = Number(pick.probabilidad);
  if (Number.isNaN(v)) return null;
  return (v > 0 && v < 1) ? +(v*100).toFixed(2) : +v.toFixed(2);
}

function impliedProbPct(odd) {
  const o = Number(odd);
  if (!Number.isFinite(o) || o <= 1) return null;
  return +(100/o).toFixed(2);
}

function calcularEV(probPct, cuota) {
  if (probPct == null) return null;
  const p = probPct / 100;
  const o = Number(cuota);
  if (!o || o <= 1) return null;
  const ev = (p * (o - 1) - (1 - p)) * 100;
  return +ev.toFixed(2);
}

function clasificarPickPorEV(ev) {
  return ev >= 40 ? 'Ultra Élite'
       : ev >= 30 ? 'Élite Mundial'
       : ev >= 20 ? 'Avanzado'
       : ev >= 15 ? 'Competitivo'
       : 'Informativo';
}

// =============== OAI JSON PARSING ===============
function extractFirstJsonBlock(text) {
  if (!text) return null;
  const match = text.match(/{[\s\S]*}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function ensurePickShape(obj) {
  const base = {
    analisis_gratuito: '',
    analisis_vip: '',
    apuesta: '',
    apuestas_extra: '',
    frase_motivacional: '',
    probabilidad: 0.0,
    no_pick: false,
    motivo_no_pick: ''
  };
  return Object.assign(base, obj || {});
}

// =============== PREDICADOS DE PICK ===============
function esNoPick(p) { return !!p && p.no_pick === true; }
function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta && typeof p.probabilidad === 'number');
}

// =============== OpenAI (ChatCompletion) ===============
async function pedirPickConModelo(modelo, prompt) {
  // Límite de llamadas por ciclo
  global.__px_oai_calls = global.__px_oai_calls || 0;
  if (global.__px_oai_calls >= MAX_OAI_CALLS_PER_CYCLE) {
    console.warn('[OAI] Límite de llamadas alcanzado en este ciclo');
    return ensurePickShape({ no_pick: true, motivo_no_pick: 'budget de IA agotado' });
  }

  const systemHint = 'Responde EXCLUSIVAMENTE un objeto JSON válido. Si no tienes certeza o hay restricciones, responde {"no_pick":true,"motivo_no_pick":"sin señal"}.';
  let tokens = 260;

  const req = buildOpenAIPayload(modelo, prompt, tokens, systemHint);
  try {
    const t0 = Date.now();
    const completion = await openai.chat.completions.create(req);
    global.__px_oai_calls = (global.__px_oai_calls||0) + 1;
    const choice = completion?.choices?.[0];
    const raw = choice?.message?.content || "";
    const meta = {
      model: modelo,
      ms: Date.now() - t0,
      finish_reason: choice?.finish_reason || "n/d",
      usage: completion?.usage || null
    };
    try { console.info("[OAI] meta=", JSON.stringify(meta)); } catch(e) {}

    if (meta.finish_reason === 'length') {
      tokens = Math.min(tokens + 80, 340);
      const modeloRetry = process.env.OPENAI_MODEL_FALLBACK || modelo;
      const messagesRetry = [
        ...req.messages,
        { role: "user", content: "⚠️ Repite TODO el JSON COMPLETO y compacto. No cortes la salida. Formato estrictamente JSON-objeto." }
      ];
      const req2 = {
        ...req,
        model: modeloRetry,
        max_completion_tokens: tokens,
        response_format: { type: "json_object" },
        messages: messagesRetry
      };
      const t1 = Date.now();
      const c2 = await openai.chat.completions.create(req2);
      global.__px_oai_calls = (global.__px_oai_calls||0) + 1;
      try {
        console.info("[OAI] meta=", JSON.stringify({
          model: modeloRetry,
          ms: Date.now() - t1,
          finish_reason: c2?.choices?.[0]?.finish_reason || "n/d",
          usage: c2?.usage || null
        }));
      } catch(e) {}
      const raw2 = c2?.choices?.[0]?.message?.content || "";
      const obj2 = extractFirstJsonBlock(raw2) || await repairPickJSON(modelo, raw2);
      return obj2 ? ensurePickShape(obj2) : null;
    }

    const obj = extractFirstJsonBlock(raw) || await repairPickJSON(modelo, raw);
    return obj ? ensurePickShape(obj) : null;

  } catch (e) {
    const msg = String(e?.message || '');
    if (/Unsupported value:\s*'temperature'|unknown parameter|unsupported parameter|response_format/i.test(msg)) {
      try {
        const req2 = buildOpenAIPayload(modelo, prompt, tokens, systemHint);
        delete req2.temperature; delete req2.top_p; delete req2.presence_penalty; delete req2.frequency_penalty;
        if (/response_format/i.test(msg) && req2.response_format) delete req2.response_format;
        const c2 = await openai.chat.completions.create(req2);
        global.__px_oai_calls = (global.__px_oai_calls||0) + 1;
        const raw2 = c2?.choices?.[0]?.message?.content || "";
        const obj2 = extractFirstJsonBlock(raw2) || await repairPickJSON(modelo, raw2);
        return obj2 ? ensurePickShape(obj2) : null;
      } catch (e2) {
        console.error('[OAI][retry] fallo:', e2?.message || e2);
        return null;
      }
    }
    console.error('[OAI] fallo:', msg);
    return null;
  }
}

async function obtenerPickConFallback(prompt) {
  let pick = await pedirPickConModelo(MODEL, prompt);
  if (!pick || !pickCompleto(pick)) {
    console.info("♻️ Fallback de modelo →", MODEL_FALLBACK);
    pick = await pedirPickConModelo(MODEL_FALLBACK, prompt);
  }
  if (!pick) {
    pick = ensurePickShape({ no_pick: true, motivo_no_pick: "sin respuesta del modelo" });
  }
  return { pick, modeloUsado: (pick && pick.no_pick) ? MODEL_FALLBACK : MODEL };
}

// =============== PROMPT ===============

// Cache simple del MD (evita E/S por pick)
let __PROMPT_MD_CACHE = null;

function readFileIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch(_) { return null; }
}

function getPromptTemplateFromMD() {
  if (__PROMPT_MD_CACHE) return __PROMPT_MD_CACHE;

  const candidates = [
    path.join(process.cwd(), 'prompts_punterx.md'),
    path.join(__dirname, 'prompts_punterx.md'),
    path.join(__dirname, '..', 'prompts_punterx.md')
  ];
  let md = null;
  for (const p of candidates) {
    md = readFileIfExists(p);
    if (md) { console.log('[PROMPT] MD detectado en', p); break; }
  }
  __PROMPT_MD_CACHE = md;
  if (!md) return null;

  // Usamos la sección 1) Pre-match (permite variaciones de guiones)
  const rx = /(?:^|\n)\s*(?:#+\s*)?1\)\s*Pre(?:-|–|\s)match[\s\S]*?(?=\n\s*(?:#+\s*)?\d+\)|\Z)/mi;
  const m = md.match(rx);
  if (!m) return null;
  return m[0].trim();
}

function renderTemplateWithMarkers(tpl, { contexto, opcionesList }) {
  if (!tpl) return null;
  let out = tpl;

  const ctxJson = JSON.stringify(contexto);
  const opciones = (opcionesList || []).map((s, i) => `${i+1}) ${s}`).join('\n');

  out = out.replace(/{{\s*CONTEXT_JSON\s*}}/g, ctxJson);
  out = out.replace(/{{\s*OPCIONES_APOSTABLES_LIST\s*}}/g, opciones);

  if (/{{\s*(CONTEXT_JSON|OPCIONES_APOSTABLES_LIST)\s*}}/.test(out)) {
    return null;
  }
  return out.trim();
}

function construirOpcionesApostables(mejoresMercados) {
  if (!Array.isArray(mejoresMercados)) return [];
  return mejoresMercados.map(m => {
    const etiqueta =
      m.marketLabel && m.outcomeLabel
        ? `${m.marketLabel}: ${m.outcomeLabel}`
        : (m.outcomeLabel || m.marketLabel || '').trim();
    return `${etiqueta} — cuota ${m.price} (${m.bookie})`;
  }).filter(Boolean);
}

function construirPrompt(partido, info, memoria) {
  const offers = partido?.marketsOffers || {};
  const mejores = [];

  const mH2H = arrBest(offers.h2h);
  if (mH2H) mejores.push({ marketLabel: "1X2", outcomeLabel: mH2H.name, price: mH2H.price, bookie: mH2H.bookie });

  const mOver = arrBest(offers.totals_over);
  if (mOver) mejores.push({ marketLabel: "Total", outcomeLabel: `Más de ${mOver.point}`,  price: mOver.price,  bookie: mOver.bookie });

  const mUnder = arrBest(offers.totals_under);
  if (mUnder) mejores.push({ marketLabel: "Total", outcomeLabel: `Menos de ${mUnder.point}`, price: mUnder.price, bookie: mUnder.bookie });

  const mSpread = arrBest(offers.spreads);
  if (mSpread) mejores.push({ marketLabel: "Hándicap", outcomeLabel: mSpread.name, price: mSpread.price, bookie: mSpread.bookie });

  const contexto = {
    liga: partido?.liga || "(por confirmar)",
    equipos: `${partido.home} vs ${partido.away}`,
    hora_relativa: formatMinAprox(Math.max(0, Math.round(partido.minutosFaltantes))),
    info_extra: info,
    memoria: (memoria || []).slice(0,5)
  };

  const opciones_apostables = construirOpcionesApostables(mejores);

  const tpl = getPromptTemplateFromMD();
  if (tpl) {
    let rendered = renderTemplateWithMarkers(tpl, { contexto, opcionesList: opciones_apostables });
    if (rendered && rendered.length > 0) {
      if (rendered.length > 8000) rendered = rendered.slice(0, 8000);
      return rendered;
    }
  }

  const prompt = [
`Eres un analista de apuestas experto. Devuelve SOLO un JSON EXACTO con esta forma:`,
`{`,
`  "analisis_gratuito": "",`,
`  "analisis_vip": "",`,
`  "apuesta": "",`,
`  "apuestas_extra": "",`,
`  "frase_motivacional": "",`,
`  "probabilidad": 0.0,`,
`  "no_pick": false,`,
`  "motivo_no_pick": ""`,
`}`,
`Reglas:`,
`- Si "no_pick" = false ⇒ "apuesta" OBLIGATORIA y "probabilidad" ∈ [0.05, 0.85].`,
`- "apuesta" debe ser EXACTAMENTE una de 'opciones_apostables' listadas abajo (cópiala literal).`,
`- Si "no_pick" = true ⇒ se permite que "apuesta" esté vacía y "probabilidad" = 0.0.`,
`- Responde SOLO el JSON sin texto adicional.`,
JSON.stringify(contexto),
`opciones_apostables (elige UNA y pégala EXACTA en "apuesta"):`,
...opciones_apostables.map((s, i) => `${i+1}) ${s}`)
].join("\n");

  return prompt;
}

// =============== EV/PROB & CHEQUEOS ===============
function seleccionarCuotaSegunApuesta(partido, apuestaStr) {
  try {
    const apuesta = normalizeStr(apuestaStr);
    const odds = partido?.marketsOffers;
    if (!odds) return null;
    const all = [
      ...(odds.h2h||[]).map(o => ({ ...o, key:'h2h', label:o.name })),
      ...(odds.totals_over||[]).map(o => ({ ...o, key:'total_over', label:`Más de ${o.point}` })),
      ...(odds.totals_under||[]).map(o => ({ ...o, key:'total_under', label:`Menos de ${o.point}` })),
      ...(odds.spreads||[]).map(o => ({ ...o, key:'spread', label:o.name }))
    ];
    const pick = all.find(o => normalizeStr(o.label) === apuesta);
    if (!pick) return null;

    const top3 = (pick.key === 'h2h')
                  ? odds.h2h.filter(x => normalizeStr(x.name) === normalizeStr(pick.label)).sort((a,b)=> b.price - a.price).slice(0,3)
                  : (pick.key === 'total_over')
                    ? odds.totals_over.filter(x => x.point === pick.point).sort((a,b)=> b.price - a.price).slice(0,3)
                    : (pick.key === 'total_under')
                      ? odds.totals_under.filter(x => x.point === pick.point).sort((a,b)=> b.price - a.price).slice(0,3)
                      : (pick.key === 'spread')
                        ? odds.spreads.filter(x => normalizeStr(x.name)===normalizeStr(pick.label)).sort((a,b)=> b.price - a.price).slice(0,3)
                        : [];

    return { valor: pick.price, point: pick.point, label: pick.label, top3: top3 || [] };
  } catch {
    return null;
  }
}

// Top 3 bookies para el mercado/outcome seleccionado (filtrado por outcome/point)
function top3ForSelectedMarket(partido, apuestaStr) {
  try {
    const apuesta = normalizeStr(apuestaStr);
    const odds = partido?.marketsOffers; if (!odds) return [];
    const all = [
      ...(odds.h2h||[]).map(o => ({ ...o, key:'h2h', label:o.name })),
      ...(odds.totals_over||[]).map(o => ({ ...o, key:'total_over', label:`Más de ${o.point}` })),
      ...(odds.totals_under||[]).map(o => ({ ...o, key:'total_under', label:`Menos de ${o.point}` })),
      ...(odds.spreads||[]).map(o => ({ ...o, key:'spread', label:o.name }))
    ];
    const pick = all.find(o => normalizeStr(o.label) === apuesta);
    if (!pick) return [];
    let pool = [];
    if (pick.key === 'h2h') pool = odds.h2h.filter(x => normalizeStr(x.name) === normalizeStr(pick.label));
    else if (pick.key === 'total_over') pool = odds.totals_over.filter(x => x.point === pick.point);
    else if (pick.key === 'total_under') pool = odds.totals_under.filter(x => x.point === pick.point);
    else if (pick.key === 'spread') pool = odds.spreads.filter(x=> normalizeStr(x.name)===normalizeStr(pick.label));
    return pool.sort((a,b)=> b.price - a.price).slice(0,3);
  } catch { return []; }
}

function apuestaCoincideConOutcome(apuestaStr, outcomeStr, homeTeam, awayTeam) {
  const a = normalizeStr(apuestaStr);
  const o = normalizeStr(outcomeStr);
  const home = normalizeStr(homeTeam || "");
  const away = normalizeStr(awayTeam || "");

  const esHome  = a.includes("1x2: local") || a.includes("local") || a.includes(home);
  const esVisit = a.includes("1x2: visitante") || a.includes("visitante") || a.includes(away);
  if (o.includes("draw") || o.includes("empate")) return a.includes("empate") || a.includes("draw");
  if (esHome && (o.includes(away) || o.includes("away"))) return false;
  if (esVisit && (o.includes(home) || o.includes("home"))) return false;
  return true;
}

// =============== Corazonada: helpers de mapeo y UI ===============
function inferPickSideFromApuesta(apuesta) {
  const s = String(apuesta || '').toLowerCase();
  if (/^\s*local\b|home\b|^1$/.test(s)) return 'home';
  if (/^\s*visitante\b|away\b|^2$/.test(s)) return 'away';
  if (/\bempate\b|draw|^x$/.test(s)) return 'draw';
  if (/over|más de|mas de/.test(s)) return 'over';
  if (/under|menos de/.test(s)) return 'under';
  if (/ambos anotan.*sí|ambos anotan.*si|btts.*yes/.test(s)) return 'btts_yes';
  if (/ambos anotan.*no|btts.*no/.test(s)) return 'btts_no';
  return 'home';
}

function inferMarketFromApuesta(apuesta) {
  const s = String(apuesta || '').toLowerCase();
  if (/ambos anotan|btts/.test(s)) return 'btts';
  if (/over|under|total|más de|menos de|mas de/.test(s)) return 'totals';
  if (/handicap/.test(s)) return 'asian_handicap';
  if (/doble oportunidad|double chance/.test(s)) return 'double_chance';
  return 'h2h';
}

function corazonadaBadge(score) {
  if (score >= 90) return '🔥';
  if (score >= 75) return '⚡';
  if (score >= 50) return '✨';
  return '';
}

// Estos builders leen tu objeto enriquecido de API-FOOTBALL (ajusta si difiere)
function buildXgStatsFromAF(af) {
  try {
    if (!af || !af.xg) return null;
    const h = af.xg.home || {};
    const a = af.xg.away || {};
    return {
      home: { xg_for: Number(h.for || h.xg_for || 0), xg_against: Number(h.against || h.xg_against || 0), n: Number(h.n || 5) },
      away: { xg_for: Number(a.for || a.xg_for || 0), xg_against: Number(a.against || a.xg_against || 0), n: Number(a.n || 5) }
    };
  } catch { return null; }
}

function buildAvailabilityFromAF(af) {
  try {
    if (!af || !af.availability) return null;
    const h = Number(af.availability.home?.deltaRating || 0);
    const a = Number(af.availability.away?.deltaRating || 0);
    return { home: { deltaRating: h }, away: { deltaRating: a } };
  } catch { return null; }
}

function buildContextFromAF(af) {
  try {
    const w = af?.weather || af?.clima || null;  // {tempC, humidity, windKmh, precipitationMm} si disponible
    const rest = af?.restDays || null; // {home, away}
    return {
      tempC: Number.isFinite(w?.tempC) ? w.tempC : null,
      humidity: Number.isFinite(w?.humidity) ? w.humidity : null,
      windKmh: Number.isFinite(w?.windKmh) ? w.windKmh : null,
      precipitationMm: Number.isFinite(w?.precipitationMm) ? w.precipitationMm : null,
      restDaysHome: Number.isFinite(rest?.home) ? rest.home : null,
      restDaysAway: Number.isFinite(rest?.away) ? rest.away : null
    };
  } catch { return null; }
}

// =============== MENSAJES (formatos) ===============
function construirMensajeVIP(partido, pick, probPct, ev, nivel, cuotaInfo, infoExtra, cz) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const top3Arr = Array.isArray(cuotaInfo?.top3) ? cuotaInfo.top3 : [];
  const american = decimalToAmerican(cuotaInfo?.valor);

  const top3Text = top3Arr.length
    ? [
      '🏦 Top 3 bookies:',
      ...top3Arr.map((b,i) => {
        const line = `${b.bookie} — ${Number(b.price).toFixed(2)}`;
        return i === 0 ? `<b>${line}</b>` : line;
      })
    ].join('\n')
    : '';

  const datos = [];
  if (infoExtra?.weather || infoExtra?.clima)   datos.push(`- Clima: disponible`);
  if (infoExtra?.arbitro) datos.push(`- Árbitro: ${infoExtra.arbitro}`);
  if (infoExtra?.estadio) datos.push(`- Estadio: ${infoExtra.estadio}${infoExtra?.ciudad ? ` (${infoExtra.ciudad})` : ''}`);
  const datosBlock = datos.length ? `\n📊 Datos avanzados:\n${datos.join('\n')}` : '';

  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)}${(cuotaInfo.point!=null) ? ` @ ${cuotaInfo.point}` : ''}`;
  const encabezadoNivel = `${emojiNivel(nivel)} ${nivel}`;

  const czLine = (cz && cz.score >= 50)
    ? `${corazonadaBadge(cz.score)} Corazonada IA: ${cz.score}/100${cz.motivo ? ` — ${cz.motivo}` : ''}`
    : '';

  const lines = [
    `🎯 PICK NIVEL: ${encabezadoNivel}`,
    `🏆 ${COUNTRY_FLAG} ${(infoExtra?.pais || partido?.pais || 'N/D')} - ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `🧠 ${pick.analisis_vip}`,
    ``,
    czLine || '',
    czLine ? '' : '',
    `EV: ${ev.toFixed(0)}% | Posibilidades de acierto: ${probPct.toFixed(0)}% | Momio: ${american}`,
    `💡 Apuesta sugerida: ${pick.apuesta}`,
    `💰 Cuota usada: ${cuotaTxt}`,
    ``,
    `📋 Apuestas extra:\n${formatApuestasExtra(pick.apuestas_extra)}`,
    top3Text ? `\n${top3Text}` : '',
    datosBlock,
    ``,
    TAGLINE,
    `\n⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Ninguna apuesta es segura.`
  ].filter(Boolean);

  return lines.join('\n');
}

function construirMensajeFREE(partido, pick, probPct, ev, nivel, cz) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const motiv = String(pick.frase_motivacional || '').trim();
  const motivLine = motiv && motiv.toLowerCase() !== 's/d' ? `\n💬 "${motiv}"\n` : '\n';

  const czLine = (cz && cz.score >= 50)
    ? `\n${corazonadaBadge(cz.score)} Corazonada IA: ${cz.score}/100${cz.motivo ? ` — ${cz.motivo}` : ''}\n`
    : '\n';

  return [
    `📡 RADAR DE VALOR`,
    `🏆 ${COUNTRY_FLAG} ${(infoFromPromptPais(partido) || 'N/D')} - ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `${pick.analisis_gratuito}`,
    motivLine.trimEnd(),
    czLine.trimEnd(),
    `⏳ Quedan menos de ${Math.max(1, mins)} minutos para este encuentro.`,
    ``,
    `🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.`,
    ``,
    `Únete al VIP para recibir el pick completo con EV, probabilidad, apuestas extra y datos avanzados.`
  ].join('\n');
}

// Helper FREE
function infoFromPromptPais(partido) {
  return partido?.pais || null;
}

// =============== TELEGRAM ===============
async function enviarFREE(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: TELEGRAM_CHANNEL_ID, text, parse_mode: 'HTML', disable_web_page_preview:true };
    const res = await fetchWithRetry(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { retries: 2, base: 600 }
    );
    if (!res.ok) { console.error('Telegram FREE error:', res.status, await safeText(res)); return false; }
    console.log(`[telegram] FREE OK len=${(text||'').length}`);
    return true;
  } catch (e) { console.error('Telegram FREE net error:', e?.message || e); return false; }
}

async function enviarVIP(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: Number(TELEGRAM_GROUP_ID), text, parse_mode: 'HTML', disable_web_page_preview:true };
    const res = await fetchWithRetry(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { retries: 2, base: 600 }
    );
    if (!res.ok) { console.error('Telegram VIP error:', res.status, await safeText(res)); return false; }
    console.log(`[telegram] FREE OK len=${(text||'').length}`);
    return true;
  } catch (e) { console.error('Telegram VIP net error:', e?.message || e); return false; }
}

// =============== SUPABASE SAVE ===============
async function guardarPickSupabase(partido, pick, probPct, ev, nivel, cuotaInfoOrNull, tipo, cz) {
  try {
    const evento = `${partido.home} vs ${partido.away} (${partido.liga})`;
    const czText = (cz && (cz.score > 0 || cz?.motivo))
      ? `\n\n[Corazonada IA] score=${cz.score}/100${cz.motivo ? ` | motivo: ${cz.motivo}` : ''}`
      : '';
    const entrada = {
      evento,
      analisis: `${pick.analisis_gratuito}\n---\n${pick.analisis_vip}${czText}`,
      apuesta: pick.apuesta,
      tipo_pick: tipo,
      liga: partido.liga,
      pais: partido.pais || null,
      equipos: `${partido.home} — ${partido.away}`,
      ev: ev,
      probabilidad: probPct,
      nivel: nivel,
      timestamp: nowISO()
    };

    // top3_json también en PRE (si se dispone del arreglo)
    if (cuotaInfoOrNull && Array.isArray(cuotaInfoOrNull.top3)) {
      entrada.top3_json = cuotaInfoOrNull.top3;
    }

    // Anti-duplicado por evento (pre-match)
    const { data: dupRow, error: dupErr } = await supabase
      .from(PICK_TABLE).select('id').eq('evento', evento).limit(1).maybeSingle();
    if (dupErr) { console.warn('Supabase dup check error:', dupErr?.message); }

    if (!dupRow) {
      const { error } = await supabase.from(PICK_TABLE).insert([ entrada ]);
      if (error) {
        console.error('Supabase insert error:', error.message);
        // Fallback: reintento sin top3_json si la columna no existe
        if (/column .* does not exist/i.test(error.message)) {
          try {
            delete entrada.top3_json;
            const { error: e2 } = await supabase.from(PICK_TABLE).insert([ entrada ]);
            if (e2) { console.error('Supabase insert (retry) error:', e2.message); resumen.guardados_fail++; }
            else { resumen.guardados_ok++;
                  try { console.log('[supabase] insert OK picks_historicos:', { evento }); } catch(e) {}
                 }
          } catch (e3) {
            console.error('Supabase insert (retry) exception:', e3?.message || e3);
            resumen.guardados_fail++;
          }
        } else {
          resumen.guardados_fail++;
        }
      } else {
        resumen.guardados_ok++;
        try { console.log('[supabase] insert OK (retry) picks_historicos:', { evento }); } catch(e) {}
      }
    } else {
      try { if (global.__px_causas) global.__px_causas.duplicado++; } catch(_) {}
      console.log('Pick duplicado, no guardado');
    }
  
  } catch (e) {
    console.error('Supabase insert exception:', e?.message || e);
    resumen.guardados_fail++;
  }
}

// =============== OpenAI PAYLOAD HELPER ===============
function buildOpenAIPayload(model, prompt, maxTokens, systemMsg=null) {
  const messages = [];
  if (systemMsg) messages.push({ role:'system', content: systemMsg });
  messages.push({ role:'user', content: prompt });

  const isG5 = /(^|\b)gpt-5(\b|-)/i.test(String(modelo||''));
  const payload = { model, messages };

  if (isG5) {
    // Modelos gpt-5*: usar max_completion_tokens y response_format JSON
    const wanted = Number(maxTokens) || 320;
    payload.max_completion_tokens = Math.min(Math.max(260, wanted), 380);
    payload.response_format = { type: "json_object" };
    // Evita sampling params en gpt-5* (algunos endpoints los rechazan)
    delete payload.temperature;
    delete payload.top_p;
    delete payload.presence_penalty;
    delete payload.frequency_penalty;
  } else {
    payload.max_tokens = maxTokens;
    payload.temperature = 0.15;
    payload.top_p = 1;
    payload.presence_penalty = 0;
    payload.frequency_penalty = 0;
  }
  return payload;
}

// =============== JSON Repair (if needed) ===============
async function repairPickJSON(model, rawText) {
  const prompt = `El siguiente mensaje debería ser solo un JSON válido pero puede estar malformado:\n<<<\n${rawText}\n>>>\nReescríbelo corrigiendo llaves, comas y comillas para que sea un JSON válido con la misma información.`;

  const fixerModel = (String(modelo||'').toLowerCase().includes('gpt-5')) ? 'gpt-5-mini' : modelo;
  const isG5 = /(^|\b)gpt-5(\b|-)/i.test(String(fixerModel||''));

  const fixReq = {
    model: fixerModel,
    messages: [{ role:'user', content: prompt }]
  };

  if (isG5) {
    // gpt-5*: sin sampling params
    fixReq.max_completion_tokens = 300;
  } else {
    fixReq.temperature = 0.2;
    fixReq.top_p = 1;
    fixReq.presence_penalty = 0;
    fixReq.frequency_penalty = 0;
    fixReq.response_format = { type: "json_object" };
    fixReq.max_tokens = 300;
  }

  const res = await openai.chat.completions.create(fixReq);
  const raw = res?.choices?.[0]?.message?.content || "";
  return extractFirstJsonBlock(raw);
}

const TAGLINE = "🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.";
