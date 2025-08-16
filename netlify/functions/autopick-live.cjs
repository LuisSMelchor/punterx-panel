// netlify/functions/autopick-live.cjs
// PunterX · Live Picks (In‑Play) — OddsAPI-first (V1)
// - Prefiltro con OddsAPI (qué es apostable, mejores precios, top‑3).
// - Enriquecimiento con API‑FOOTBALL (minuto, marcador, fase).
// - IA sólo si pasa el prefiltro. EV + validaciones. Clasificación (FREE/VIP).
// - Telegram (mensajes LIVE ya definidos en send.js). Supabase (histórico).
// - CommonJS, Node 20, sin top-level await.

"use strict";

/* ============ Blindaje runtime ============ */
try { if (typeof fetch === "undefined") global.fetch = require("node-fetch"); } catch (_) {}
try {
  process.on("uncaughtException", e => console.error("[UNCAUGHT]", e && (e.stack||e.message||e)));
  process.on("unhandledRejection", e => console.error("[UNHANDLED]", e && (e.stack||e.message||e)));
} catch {}

/* ============ Imports ============ */
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const path = require("path");

/* ============ ENV ============ */
const {
  SUPABASE_URL, SUPABASE_KEY,
  OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID,
  ODDS_API_KEY, API_FOOTBALL_KEY,

  // Live tunables (con defaults seguros)
  LIVE_MIN_BOOKIES = "3",
  LIVE_POLL_MS = "25000",
  LIVE_COOLDOWN_MIN = "8",
  LIVE_MARKETS = "h2h,totals,spreads",
  LIVE_REGIONS = "eu,uk,us",
  LIVE_PREFILTER_GAP_PP = "5",     // gap consenso vs mejor (p.p.)
  RUN_WINDOW_MS = "60000"          // ventana interna (Netlify background)
} = process.env;

function assertEnv() {
  const required = [
    "SUPABASE_URL","SUPABASE_KEY","OPENAI_API_KEY",
    "TELEGRAM_BOT_TOKEN","TELEGRAM_CHANNEL_ID","TELEGRAM_GROUP_ID",
    "API_FOOTBALL_KEY","ODDS_API_KEY"
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error("❌ ENV faltantes:", missing.join(", "));
    throw new Error("Variables de entorno faltantes (autopick-live)");
  }
}

/* ============ Clientes ============ */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Helpers de envío (debes tener netlify/functions/send.js con LIVE FREE/VIP)
let send = null;
try { send = require("./send"); }
catch { try { send = require("../send"); } catch (e) { throw new Error("No se pudo cargar send.js (helpers LIVE)"); } }

/* ============ Utils ============ */
const PROB_MIN = 5;   // %
const PROB_MAX = 85;  // %
const GAP_MAX  = 15;  // p.p. IA vs implícita
const EV_VIP   = 15;  // %
const EV_FREE0 = 10;  // %

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

/* ============ Mapa de ligas → sport_key (OddsAPI) ============ */
// Amplía libremente esta lista; así arrancamos cubriendo ligas top.
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
  "South America - Copa Libertadores": "soccer_conmebol_libertadores",
  "South America - Copa Sudamericana": "soccer_conmebol_sudamericana"
};


/* ============ OddsAPI Sports Map & Fallback (404) ============ */
const ODDS_HOST = 'https://api.the-odds-api.com';

const __norm = (s) => String(s||'')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/\s+/g,' ')
  .trim().toLowerCase();

let __sportsCache = null;
async function loadOddsSportsMap(){
  if (__sportsCache) return __sportsCache;
  const url = `${ODDS_HOST}/v4/sports?all=true&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
  const res = await fetch(url);
  if (!res?.ok) {
    console.warn('[OddsAPI] /v4/sports fallo:', res?.status, await safeText(res));
    __sportsCache = { byKey:{}, byTitle:{} };
    return __sportsCache;
  }
  const arr = await res.json().catch(()=>[]);
  const byKey = {}; const byTitle = {};
  for (const s of arr) {
    if (!s?.key) continue;
    byKey[s.key] = s;
    if (s?.title) byTitle[__norm(s.title)] = s;
    if (s?.description) byTitle[__norm(s.description)] = s;
  }
  __sportsCache = { byKey, byTitle };
  return __sportsCache;
}

async function resolveSportKeyFallback(originalKey){
  try {
    const cache = await loadOddsSportsMap();
    // si no existe, intenta por títulos conocidos
    const candidates = ['libertadores','sudamericana','conmebol'];
    for (const [tNorm, obj] of Object.entries(cache.byTitle)) {
      if (candidates.some(c=> tNorm.includes(c))) return obj.key;
    }
  } catch(e){
    console.warn('[OddsAPI] resolveSportKeyFallback error:', e?.message||e);
  }
  return null;
}

async function fetchOddsWithFallback(sportKey, regions, markets){
  const u = `${ODDS_HOST}/v4/sports/${encodeURIComponent(sportKey)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=unix`;
  const r = await fetch(u);
  if (r.ok) return r;
  if (r.status === 404){
    console.warn('[OddsAPI] odds err:', sportKey, 404, '→ fallback map');
    const alt = await resolveSportKeyFallback(sportKey);
    if (alt && alt !== sportKey){
      const u2 = `${ODDS_HOST}/v4/sports/${encodeURIComponent(alt)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(regions)}&markets=${encodeURIComponent(markets)}&oddsFormat=decimal&dateFormat=unix`;
      const r2 = await fetch(u2);
      if (r2.ok){
        console.info('[OddsAPI] fallback OK:', sportKey, '→', alt);
        return r2;
      } else {
        console.warn('[OddsAPI] fallback también falló:', alt, r2.status, await safeText(r2));
      }
    } else {
      console.warn('[OddsAPI] sin alternativa para', sportKey);
    }
  }
  return r;
}
/* ============ Fetchers ============ */

// API‑FOOTBALL — fixtures en vivo (minuto, marcador, liga/país)
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

// OddsAPI — eventos en vivo por lista de sport_keys (primario)
async function oddsapiLiveEventsByKeys(sportKeys){
  if (!ODDS_API_KEY) return [];
  const out = [];
  for (const key of sportKeys) {
    // Nota: v4 /odds devuelve también eventos live y próximos por sport_key
    const url = `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(key)}/odds?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(LIVE_REGIONS)}&markets=${encodeURIComponent(LIVE_MARKETS)}&oddsFormat=decimal&dateFormat=unix`;
    const res = await fetch(url);
    if (!res.ok) { console.warn("[OddsAPI] odds err:", key, res.status); continue; }
    const events = await safeJson(res);
    if (Array.isArray(events)) out.push(...events);
  }
  return out;
}

// Top‑3 + consenso desde estructura de OddsAPI
function consensusAndTop3FromOddsapiEvent(oddsEvent){
  // oddsEvent: { bookmakers: [{title, markets:[{key,outcomes:[{name,price,point?}] }]}], home_team, away_team, sport_key, ... }
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

    // agrupa por (market,label,point)
    const byKey = new Map();
    for (const o of offers) {
      const k = `${o.market}||${o.label}||${o.point ?? "-"}`.toLowerCase();
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(o);
    }

    // prioriza markets conocidos
    const order = ["h2h","totals","spreads"];
    const keys = Array.from(byKey.keys()).sort((a,b)=>{
      const ma = order.findIndex(m => a.startsWith(m));
      const mb = order.findIndex(m => b.startsWith(m));
      return (ma===-1?99:ma) - (mb===-1?99:mb);
    });

    let best = null, consensus = null, top3 = null;
    for (const k of keys) {
      const arr = byKey.get(k);
      // mediana
      const prices = arr.map(x=>x.price).sort((a,b)=>a-b);
      const mid = Math.floor(prices.length/2);
      const med = prices.length%2 ? prices[mid] : (prices[mid-1]+prices[mid])/2;

      // top‑3 deduplicado por casa
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
        // Usa el primer arr para anclar market/label/point
        consensus = { market: arr[0].market, label: arr[0].label, price: med, point: arr[0].point ?? null };
        top3 = uniq.slice(0,3);
      }
    }
    if (!best || !consensus) return null;
    const gap_pp = Math.max(0, (impliedProbPct(consensus.price)||0) - (impliedProbPct(best.price)||0));
    return { best, consensus, top3, gap_pp };
  } catch { return null; }
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
const PICK_TABLE = "picks_historicos";

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

/* ============ Core de evaluación (OddsAPI → AF) ============ */
async function evaluateOddsEvent(oddsEvent, afLiveIndex){
  // 1) Prefiltro (OddsAPI)
  const pref = consensusAndTop3FromOddsapiEvent(oddsEvent);
  if (!pref) return;

  const bookiesCount = new Set((oddsEvent.bookmakers||[]).map(b=> (b.title||"").toLowerCase().trim())).size;
  if (bookiesCount < Number(LIVE_MIN_BOOKIES)||3) return;

  if ((pref.gap_pp||0) < Number(LIVE_PREFILTER_GAP_PP)) return;

  // 2) Enriquecer con API‑FOOTBALL (match por nombres)
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

  // Anti-duplicado ligero por fixture (bucket 5’)
  const mb = minuteBucket(fx.minute);
  const dup = await alreadySentLive({ fixture_id: fx.fixture_id, minute_bucket: mb });
  if (dup) return;

  // 5) Payloads y envío
  const nivel = nivelPorEV(ev);
  const payloadVIP = {
    nivel,
    pais: fx.country || "INT",
    liga: fx.league || "Liga",
    equipos: `${fx.home} vs ${fx.away}`,
    minuto: `${fx.minute}’`,
    marcador: fx.score,
    fase: fx.phase,
    ev: Math.round(ev),
    probabilidad: Math.round(probPct),
    momio: String(pref.best.price),
    apuesta_sugerida: ia.apuesta || `${pref.consensus.market}: ${pref.consensus.label}`,
    vigencia: "válida mientras la cuota no caiga significativamente o hasta cambios de estado",
    apuestas_extra: ia.apuestas_extra || [],
    razonamiento: (ia.analisis_vip || ia.analisis_gratuito || "Se detecta oportunidad por dinámica de juego.").split("\n").filter(Boolean),
    top3: pref.top3 || [],
    snapshot: `Consenso: ${Number(pref.consensus.price).toFixed(2)} | Mejor: ${Number(pref.best.price).toFixed(2)} | Volatilidad: media\nDisparador: gap de ${pref.gap_pp.toFixed(2)} p.p. entre consenso y mejor`
  };

  const payloadFREE = {
    pais: fx.country || "INT",
    liga: fx.league || "Liga",
    equipos: `${fx.home} vs ${fx.away}`,
    minuto: `${fx.minute}’`,
    marcador: fx.score,
    fase: fx.phase,
    razonamiento: (ia.analisis_gratuito || "Se detecta oportunidad por ajustes de línea.").split("\n").filter(Boolean)
  };

  let sent;
  if (isVIP) sent = await send.sendLiveVip(payloadVIP, { pin: true });
  else       sent = await send.sendLiveFree(payloadFREE);

  // 6) Guardar en Supabase
  const textoGuardado = isVIP
    ? `LIVE ${nivel}\n${fx.country} - ${fx.league}\n${payloadVIP.equipos}\nEV ${payloadVIP.ev}% | Prob ${payloadVIP.probabilidad}% | Momio ${payloadVIP.momio}\n${ia.analisis_vip}`
    : `FREE LIVE\n${fx.country} - ${fx.league}\n${payloadFREE.equipos}\n${ia.analisis_gratuito}`;

  await saveLivePick({
    fixture_id: fx.fixture_id,
    liga: fx.league, pais: fx.country, equipos: `${fx.home} vs ${fx.away}`,
    ev, probPct, nivel,
    texto: textoGuardado,
    apuesta: ia.apuesta || "",
    minuto: fx.minute, fase: fx.phase, marcador: fx.score,
    market_point: pref.consensus.point ?? null,
    vigencia_text: isVIP ? payloadVIP.vigencia : "",
    isVIP
  });

  // (Opc) guarda sent.message_id en tu cola signals_live si vas a editar luego
}

/* ============ Ventana de ejecución (Netlify/Replit) ============ */
async function runWindow(){
  const t0 = Date.now();

  // 1) sport_keys a partir del pool de ligas objetivo
  const sportKeys = Array.from(new Set(Object.values(LIGA_TO_SPORTKEY)));

  // 2) Index en vivo de AF para match de equipos → fixture (minuto/score/fase)
  const fixtures = await afLiveFixtures();
  const afIndex = new Map();
  for (const fx of fixtures) {
    const key = `${(fx.home||"").toLowerCase()}||${(fx.away||"").toLowerCase()}`;
    afIndex.set(key, fx);
  }

  while (Date.now() - t0 < Number(RUN_WINDOW_MS)) {
    // 3) Trae eventos LIVE desde OddsAPI (primario)
    const oddsEvents = await oddsapiLiveEventsByKeys(sportKeys);

    // 4) Evalúa cada evento (OddsAPI → AF → IA → Telegram → Supabase)
    for (const ev of (oddsEvents || [])) {
      const home = (ev.home_team||"").toLowerCase();
      const away = (ev.away_team||"").toLowerCase();
      if (!home || !away) continue;

      // mercados y casas suficientes
      const hasMarkets = Array.isArray(ev.bookmakers) && ev.bookmakers.some(b => Array.isArray(b.markets) && b.markets.length);
      const bkCount = new Set((ev.bookmakers||[]).map(b=> (b.title||"").toLowerCase().trim())).size;
      if (!hasMarkets || bkCount < Number(LIVE_MIN_BOOKIES)) continue;

      try { await evaluateOddsEvent(ev, afIndex); } catch (e) { console.error("[evaluateOddsEvent]", e?.message||e); }
    }

    await sleep(Number(LIVE_POLL_MS)||25000);
  }
}

/* ============ Netlify handler ============ */
exports.handler = async function handler(){
  try {
    assertEnv();
    await runWindow();
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error("LIVE handler error:", e?.message||e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message||"live failed" }) };
  }
};

/* ============ Modo standalone (Replit/local) ============ */
// Ejecuta: `node netlify/functions/autopick-live.cjs --loop`
if (require.main === module) {
  (async () => {
    assertEnv();
    console.log("▶️ PunterX Live — loop continuo (Ctrl+C para salir)");
    while (true) {
      try { await runWindow(); } catch (e) { console.error("[loop]", e?.message||e); }
      await sleep(1000); // pequeño respiro entre ventanas
    }
  })();
}
