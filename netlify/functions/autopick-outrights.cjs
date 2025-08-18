// netlify/functions/autopick-outrights.cjs
// PunterX · Autopick OUTRIGHTS (Apuestas a Futuro)
// - Teaser ~7 días antes (FREE + VIP).
// - Pick final 24 ± 2 horas antes del inicio (VIP si EV ≥15%, FREE si 10–14.9%).
// - Top‑3 “Mejores 3 casas para apostar” (#1 en negritas).
// - Apuestas extra: solo las de mayor probabilidad (umbral configurable).
// - CommonJS, Node 20, sin top-level await, sin dependencias nuevas.

"use strict";

/* ============================ Blindaje runtime ============================ */
try {
  if (typeof fetch === "undefined") {
    global.fetch = require("node-fetch");
  }
} catch (_) {}

try {
  process.on("uncaughtException", (e) => {
    try { console.error("[UNCAUGHT]", e && (e.stack || e.message || e)); } catch {}
  });
  process.on("unhandledRejection", (e) => {
    try { console.error("[UNHANDLED]", e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) {}

/* ============================ Imports ============================ */
const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

/* ============================ ENV ============================ */
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID, // FREE
  TELEGRAM_GROUP_ID,   // VIP
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK,
  COUNTRY_FLAG,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
} = process.env;

function assertEnv() {
  const required = [
    "SUPABASE_URL","SUPABASE_KEY","OPENAI_API_KEY","TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID","TELEGRAM_GROUP_ID","ODDS_API_KEY","API_FOOTBALL_KEY"
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error("❌ ENV faltantes:", missing.join(", "));
    throw new Error("Variables de entorno faltantes");
  }
}

/* ============================ Config ============================ */
const MODEL = OPENAI_MODEL || "gpt-5-mini";
const MODEL_FALLBACK = OPENAI_MODEL_FALLBACK || "gpt-5";
const FLAG = COUNTRY_FLAG || "🌍";

// Ventanas (ajustables)
const TEASER_D_MIN = 6;   // >=6 días
const TEASER_D_MAX = 8;   // <=8 días  (≈ 7 ± 1 día)
const FINAL_H_MIN  = 22;  // >=22 horas
const FINAL_H_MAX  = 26;  // <=26 horas (≈ 24 ± 2 horas)

// Umbrales de negocio
const PROB_MIN = 5;         // %
const PROB_MAX = 85;        // %
const GAP_MAX  = 15;        // p.p. diferencia prob IA vs implícita
const EV_MIN_SAVE = 10;     // %
const EV_MIN_VIP  = 15;     // % (≥15 → VIP; 10–14.9 → FREE)

// Apuestas extra (filtro)
const EXTRA_UMBRAL_PCT = 45;  // %
const EXTRA_MAX = 4;

// Supabase
const PICK_TABLE = "picks_historicos";
const OUTRIGHT_TYPES = { TEASER: "OUTRIGHT-TEASER", FINAL: "OUTRIGHT" };

/* ============================ Clientes ============================ */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ============================ Utils ============================ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ""; } }
function nowISO() { return new Date().toISOString(); }

function hoursUntilISO(iso) { return Math.round((Date.parse(iso) - Date.now())/36e5); }
function daysUntilISO(iso)  { return Math.round((Date.parse(iso) - Date.now())/864e5); }

async function fetchWithRetry(url, init={}, opts={ retries: 1, base: 400 }) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= opts.retries) return res;
        const ra = Number(res.headers.get("retry-after")) || 0;
        const backoff = ra ? ra*1000 : (opts.base * Math.pow(2, attempt));
        await sleep(backoff);
        attempt++; continue;
      }
      return res;
    } catch (e) {
      if (attempt >= opts.retries) throw e;
      await sleep(opts.base * Math.pow(2, attempt));
      attempt++;
    }
  }
}

// Prob implícita y EV
function impliedProbPct(cuota) {
  const c = Number(cuota);
  if (!Number.isFinite(c) || c <= 1.0) return null;
  return +((100 / c).toFixed(2));
}
function calcularEV(probPct, cuota) {
  const p = Number(probPct)/100;
  const c = Number(cuota);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  return +(((p * c) - 1) * 100).toFixed(2);
}
// Momio americano
function decimalToAmerican(d) {
  const dec = Number(d);
  if (!Number.isFinite(dec) || dec <= 1) return "n/d";
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}

/* ============================ OddsAPI + API-FOOTBALL (fetchOutrights) ============================ */
/**
 * Devuelve torneos con mercados OUTRIGHTS normalizados:
 * [{
 *   torneoClave, liga, temporada, pais, startsAtISO,
 *   markets: [{ market:"Outright", label:"Manchester City", price:5.5, bookie:"Bet365" }, ...],
 *   extrasSugeridas: [] // opcional
 * }]
 */
async function fetchOutrights() {
  const out = [];

  // 1) Lista de sports en OddsAPI y filtra Soccer con has_outrights = true
  const sportsURL = `https://api.the-odds-api.com/v4/sports/?apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
  const sRes = await fetchWithRetry(sportsURL, { method: "GET" }, { retries: 1, base: 600 });
  if (!sRes.ok) {
    console.error("[OUT] OddsAPI /sports error:", sRes.status, await safeText(sRes));
    return out;
  }
  const sports = await safeJson(sRes);
  const soccerOutrights = (Array.isArray(sports) ? sports : [])
    .filter(s => String(s.group).toLowerCase() === "soccer" && s.has_outrights === true);

  if (!soccerOutrights.length) {
    console.info("[OUT] OddsAPI: sin sports de soccer con has_outrights=true por ahora.");
    return out;
  }

  // 2) Para cada sport con outrights, pedir mercado `outrights`
  const REGIONS = process.env.ODDS_REGIONS || process.env.LIVE_REGIONS || "us,uk,eu,au";
  for (const s of soccerOutrights) {
    const oddsURL =
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(s.key)}/odds` +
      `?apiKey=${encodeURIComponent(ODDS_API_KEY)}&regions=${encodeURIComponent(REGIONS)}` +
      `&markets=outrights&oddsFormat=decimal&dateFormat=iso`;
    const oRes = await fetchWithRetry(oddsURL, { method: "GET" }, { retries: 1, base: 800 });
    if (!oRes.ok) {
      const bodyTxt = await safeText(oRes);
      console.warn("[OUT] OddsAPI /odds outrights error:", s.key, oRes.status, bodyTxt.slice(0,400));
      continue;
    }
    const events = await safeJson(oRes);
    if (!Array.isArray(events) || !events.length) continue;

    // 3) Para cada "evento" de outrights, construir markets consolidando mejor cuota por selección
    for (const ev of events) {
      // Mapea bookies -> markets -> outcomes (outrights)
      // Estructura odds v4: ev.bookmakers[].markets[].key === 'outrights'
      const offers = [];
      for (const bk of (ev.bookmakers || [])) {
        const bkTitle = bk.title || bk.key || "bookie";
        for (const mk of (bk.markets || [])) {
          if (String(mk.key).toLowerCase() !== "outrights") continue;
          for (const oc of (mk.outcomes || [])) {
            const label = oc.name;
            const price = Number(oc.price);
            if (!label || !Number.isFinite(price)) continue;
            offers.push({ market: "Outright", label, price, bookie: bkTitle });
          }
        }
      }
      if (!offers.length) continue;

      // Consolidar mejor cuota por selección
      const bestByLabel = new Map();
      for (const o of offers) {
        const k = String(o.label).trim().toLowerCase();
        const prev = bestByLabel.get(k);
        if (!prev || o.price > prev.price) bestByLabel.set(k, o);
      }
      const markets = Array.from(bestByLabel.values()).sort((a,b)=> b.price - a.price);

      // 4) Enriquecer con API-FOOTBALL: start/end de la temporada del torneo
      const ligaTitle = s.title || ev.sport_title || "Torneo";
      const enrich = await apiFootballResolveLeague(ligaTitle, s.key || ev.sport_key);
      const liga = enrich.leagueName || ligaTitle;
      const temporada = enrich.season || guessSeasonFromTitle(ligaTitle) || new Date().getUTCFullYear().toString();
      const pais = enrich.country || (s.description || "INT");
      const startsAtISO = enrich.start || ev.commence_time || soonInDaysISO(7); // fallback seguro

      const torneoClave = `${pais}:${liga}:${temporada}`;
      out.push({
        torneoClave, liga, temporada, pais, startsAtISO,
        markets,
        extrasSugeridas: [] // puedes poblar con otras fuentes si quieres
      });
    }
  }

  return out;
}

// Heurística: intenta extraer un año (temporada) del título, si aplica
function guessSeasonFromTitle(title) {
  if (!title) return null;
  const m = String(title).match(/(20\d{2})/);
  return m ? m[1] : null;
}
function soonInDaysISO(d=7) {
  const t = new Date(Date.now() + d*864e5);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 12, 0, 0)).toISOString();
}

/**
 * API‑FOOTBALL: resuelve liga por nombre aproximado y devuelve
 * { leagueName, season, country, start, end }
 */

// ---- Mapa OddsAPI sport_key → API-FOOTBALL league_id (outrights) ----
const AF_LEAGUE_ID_BY_SPORTKEY = {}; // deprecado: resolver AF por búsqueda textual/season vigente

function apiFootballResolveLeague(searchName, sportKey) {
  const out = { leagueName: null, season: null, country: null, start: null, end: null };
  const afId = AF_LEAGUE_ID_BY_SPORTKEY[String(sportKey||"").trim()] || null;

  // 1) Si tenemos mapeo directo por sport_key → league_id, usa /leagues?id=
  if (afId) {
    return (async () => {
      const url = `https://v3.football.api-sports.io/leagues?id=${encodeURIComponent(afId)}`;
      const res = await fetchWithRetry(url, { method: "GET", headers: { "x-apisports-key": API_FOOTBALL_KEY } }, { retries: 1, base: 700 });
      if (res && res.ok) {
        const data = await safeJson(res);
        const item = data?.response?.[0];
        if (item) {
          out.leagueName = item.league?.name || searchName || null;
          out.country   = item.country?.name || null;
          // Selecciona temporada más reciente con fechas
          const seasons = Array.isArray(item.seasons) ? item.seasons : [];
          let best = seasons.filter(s=>s.start && s.end).sort((a,b)=> (Date.parse(b.start||"")||0) - (Date.parse(a.start||"")||0))[0] || seasons[0];
          if (best) {
            out.season = String(best.year || best.season || "").trim() || null;
            out.start  = best.start || null;
            out.end    = best.end || null;
          }
          return out;
        }
      } else if (res) {
        console.warn("[OUT] AF leagues?id error:", res.status, await safeText(res));
      }
      // Si no hay datos, cae al fallback textual
      return await apiFootballResolveLeagueFallback(searchName);
    })();
  }

  // 2) Fallback textual
  return apiFootballResolveLeagueFallback(searchName);
}

async function apiFootballResolveLeagueFallback(searchName) {
  const out = { leagueName: null, season: null, country: null, start: null, end: null };
  if (!searchName) return out;

  const url = `https://v3.football.api-sports.io/leagues?search=${encodeURIComponent(searchName)}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { "x-apisports-key": API_FOOTBALL_KEY }
  }, { retries: 1, base: 700 });

  if (!res.ok) {
    console.warn("[OUT] API-FOOTBALL leagues?search error:", res.status, await safeText(res));
    return out;
  }
  const data = await safeJson(res);
  const arr = (data && data.response) || [];
  if (!Array.isArray(arr) || !arr.length) return out;

  // Toma la mejor coincidencia y la temporada reciente
  let bestItem = arr[0];
  out.leagueName = bestItem?.league?.name || searchName || null;
  out.country    = bestItem?.country?.name || null;

  const seasons = Array.isArray(bestItem?.seasons) ? bestItem.seasons : [];
  let best = null;
  for (const s of seasons) {
    if (s.current === true) { best = s; break; }
  }
  if (!best && seasons.length) {
    seasons.sort((a,b)=> (Date.parse(a.start||"")||0) - (Date.parse(b.start||"")||0));
    best = seasons[0];
  }
  if (best) {
    out.season = String(best.year || best.season || "").trim() || null;
    out.start  = best.start || null;
    out.end    = best.end || null;
  }
  return out;
}

/* ============================ IA (OpenAI) ============================ */
function buildOpenAIPayload(model, prompt, maxOut=450, systemMsg) {
  const m = String(model || "").toLowerCase();
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);
  const base = {
    model,
    response_format: { type: "json_object" },
    messages: [
      ...(systemMsg ? [{ role: "system", content: systemMsg }] : []),
      { role: "user", content: prompt }
    ],
  };
  if (modern) base.max_completion_tokens = maxOut;
  else base.max_tokens = maxOut;
  if (!/gpt-5|o3/.test(m)) base.temperature = 0.2;
  return base;
}
function extractFirstJsonBlock(text) {
  if (!text) return null;
  const t = String(text).replace(/```json|```/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}
function ensurePickShape(p) {
  if (!p || typeof p !== "object") p = {};
  return {
    analisis_gratuito: p.analisis_gratuito ?? "s/d",
    analisis_vip: p.analisis_vip ?? "s/d",
    apuesta: p.apuesta ?? "",
    apuestas_extra: p.apuestas_extra ?? "",
    frase_motivacional: p.frase_motivacional ?? "s/d",
    probabilidad: Number.isFinite(p.probabilidad) ? Number(p.probabilidad) : 0,
    no_pick: p.no_pick === true,
    motivo_no_pick: p.motivo_no_pick ?? ""
  };
}
async function repairPickJSON(modelo, rawText) {
  const prompt = `Reescribe el contenido en un JSON válido con estas claves EXACTAS:
{
  "analisis_gratuito": "",
  "analisis_vip": "",
  "apuesta": "",
  "apuestas_extra": "",
  "frase_motivacional": "",
  "probabilidad": 0.0,
  "no_pick": false,
  "motivo_no_pick": ""
}
Si algún dato no aparece, coloca "s/d" y para "probabilidad" usa 0.0. Responde SOLO el JSON.
Contenido:
${rawText || ""}`;
  const completion = await openai.chat.completions.create(buildOpenAIPayload(MODEL_FALLBACK, prompt, 250));
  const content = completion?.choices?.[0]?.message?.content || "";
  return extractFirstJsonBlock(content);
}
function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta && typeof p.probabilidad === "number");
}
function esNoPick(p) { return !!p && p.no_pick === true; }

async function pedirPickConModelo(modelo, prompt) {
  const systemHint = "Responde EXCLUSIVAMENTE un objeto JSON válido. Si no hay señal clara, devuelve {\"no_pick\":true,\"motivo_no_pick\":\"outright sin señal\"}.";
  const req = buildOpenAIPayload(modelo, prompt, 450, systemHint);
  const t0 = Date.now();
  const completion = await openai.chat.completions.create(req);
  const choice = completion?.choices?.[0];
  const raw = choice?.message?.content || "";
  try {
    console.info("[OAI-meta]", JSON.stringify({
      model: modelo,
      ms: Date.now()-t0,
      finish_reason: choice?.finish_reason || "n/d",
      usage: completion?.usage || null
    }));
  } catch {}
  let obj = extractFirstJsonBlock(raw);
  if (!obj && raw) {
    try { obj = await repairPickJSON(modelo, raw); }
    catch(e){ console.warn("[REPAIR] fallo:", e?.message || e); }
  }
  if (!obj) {
    const mini = `{"analisis_gratuito":"s/d","analisis_vip":"s/d","apuesta":"","apuestas_extra":"","frase_motivacional":"s/d","probabilidad":0.0,"no_pick":true,"motivo_no_pick":"respuesta vacía o no parseable (outrights)"}`;
    const c2 = await openai.chat.completions.create(buildOpenAIPayload(modelo, mini, 120, systemHint));
    const raw2 = c2?.choices?.[0]?.message?.content || "";
    obj = extractFirstJsonBlock(raw2);
  }
  if (!obj) return null;
  return ensurePickShape(obj);
}
async function obtenerPickConFallback(prompt) {
  let pick = await pedirPickConModelo(MODEL, prompt);
  if (!pick || !pickCompleto(pick)) {
    console.info("♻️ Fallback de modelo →", MODEL_FALLBACK);
    pick = await pedirPickConModelo(MODEL_FALLBACK, prompt);
  }
  if (!pick) pick = ensurePickShape({ no_pick: true, motivo_no_pick: "sin respuesta del modelo (outrights)" });
  return { pick, modeloUsado: (pick && pick.no_pick) ? MODEL_FALLBACK : MODEL };
}

/* ============================ Prompt ============================ */
function readFileIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function getPromptTemplateFromMD() {
  const candidates = [
    path.join(process.cwd(), "prompts_punterx.md"),
    path.join(__dirname, "prompts_punterx.md"),
    path.join(__dirname, "..", "prompts_punterx.md"),
  ];
  let md = null;
  for (const p of candidates) { md = readFileIfExists(p); if (md) break; }
  if (!md) return null;
  // Extrae la sección de Outrights si la tienes; fallback al pre-match si no.
  const rx = /^\s*(?:#+\s*)?(?:outrights?|apuestas a futuro)\b[\s\S]*?(?=^\s*(?:#+\s*)?\w)/mi;
  const m = md.match(rx);
  if (m) return m[0].trim();
  // fallback al 1) pre-match si no hay sección específica
  const rx2 = /^\s*(?:#+\s*)?1\)\s*Pre[ -‑]match\b[\s\S]*?(?=^\s*(?:#+\s*)?\d+\)\s|\Z)/mi;
  const m2 = md.match(rx2);
  return (m2 ? m2[0].trim() : null);
}

function renderTemplateWithMarkers(tpl, { contexto, opcionesList }) {
  if (!tpl) return null;
  let out = tpl;
  const ctxJson = JSON.stringify(contexto);
  const opciones = (opcionesList || []).map((s, i) => `${i+1}) ${s}`).join("\n");
  out = out.replace(/\{\{\s*CONTEXT_JSON\s*\}\}/g, ctxJson);
  out = out.replace(/\{\{\s*OPCIONES_APOSTABLES_LIST\s*\}\}/g, opciones);
  if (/\{\{\s*(CONTEXT_JSON|OPCIONES_APOSTABLES_LIST)\s*\}\}/.test(out)) return null;
  return out.trim();
}

function construirOpcionesOutrights(markets) {
  if (!Array.isArray(markets)) return [];
  return markets.map(m => {
    // etiqueta humana: "Outright: Man City — cuota 5.50 (Bet365)"
    const market = (m.market || "Outright").trim();
    const label = (m.label  || "").trim();
    const price = Number(m.price);
    const bookie= (m.bookie||"").trim();
    return `${market}: ${label} — cuota ${price} (${bookie})`;
  }).filter(Boolean);
}

function construirPromptOutright(torneo, markets, memoria) {
  const contexto = {
    torneo: torneo?.liga || "(por confirmar)",
    temporada: torneo?.temporada || "(s/d)",
    pais: torneo?.pais || "(s/d)",
    inicia_en: `${Math.max(0, hoursUntilISO(torneo.startsAtISO))}h`,
    info_extra: {
      startsAtISO: torneo.startsAtISO,
    },
    memoria: (memoria || []).slice(0,5)
  };

  const opciones = construirOpcionesOutrights(markets);

  const tpl = getPromptTemplateFromMD();
  if (tpl) {
    let rendered = renderTemplateWithMarkers(tpl, { contexto, opcionesList: opciones });
    if (rendered && rendered.length > 0) {
      if (rendered.length > 8000) rendered = rendered.slice(0, 8000);
      return rendered;
    }
  }

  // Fallback
  const prompt = [
    `Eres un analista experto en outrights (apuestas a futuro). Devuelve SOLO un JSON EXACTO con esta forma:`,
    `{`,
    `  "analisis_gratuito": ""`,
    `  "analisis_vip": ""`,
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
    `- Si "no_pick" = true ⇒ "apuesta" vacía y "probabilidad" = 0.0.`,
    `- Responde SOLO el JSON sin texto adicional.`,
    ``,
    JSON.stringify(contexto),
    ``,
    `opciones_apostables (elige UNA y pégala EXACTA en "apuesta"):`,
    ...opciones.map((s, i) => `${i+1}) ${s}`)
  ].join("\n");

  return prompt;
}

/* ============================ Memoria (Supabase) ============================ */
async function existsPickForTournament(supabase, torneoClave, tipo) {
  try {
    const { data, error } = await supabase
      .from(PICK_TABLE)
      .select("id")
      .eq("evento", torneoClave)
      .eq("tipo_pick", tipo)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}
async function guardarPickSupabaseOutright({ torneoClave, texto, pick, probPct, ev, nivel, tipo, liga }) {
  try {
    const entrada = {
      evento: torneoClave,
      analisis: texto || `${pick?.analisis_gratuito || "s/d"}\n---\n${pick?.analisis_vip || "s/d"}`,
      apuesta: pick?.apuesta || "",
      tipo_pick: tipo,
      liga: liga || "(outright)",
      equipos: torneoClave,
      ev: Number.isFinite(ev) ? ev : 0,
      probabilidad: Number.isFinite(probPct) ? probPct : 0,
      nivel: nivel || "Informativo",
      timestamp: nowISO()
    };
    const { error } = await supabase.from(PICK_TABLE).insert([entrada]);
    if (error) { console.error("Supabase insert error:", error.message); return false; }
    return true;
  } catch (e) {
    console.error("Supabase insert ex:", e?.message || e);
    return false;
  }
}

/* ============================ Telegram ============================ */
async function enviarTelegram(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { retries: 2, base: 600 });
    if (!res.ok) { console.error("Telegram error:", res.status, await safeText(res)); return false; }
    return true;
  } catch (e) {
    console.error("Telegram net error:", e?.message || e);
    return false;
  }
}
const enviarFREE = (text) => enviarTelegram(TELEGRAM_CHANNEL_ID, text);
const enviarVIP  = (text) => enviarTelegram(Number(TELEGRAM_GROUP_ID), text);

/* ============================ Apuestas extra (filtro) ============================ */
function inferirProbImplicita(cuotaDecimal) {
  const c = Number(cuotaDecimal);
  if (!Number.isFinite(c) || c <= 1) return 0;
  return +(100 / c).toFixed(2);
}
function filtrarApuestasExtra(extras, { umbralPct = EXTRA_UMBRAL_PCT, maxN = EXTRA_MAX } = {}) {
  const uniq = new Set();
  const scored = (extras || []).map(e => {
    const prob = Number(e?.probabilidad);
    const probPct = Number.isFinite(prob)
      ? (prob > 0 && prob < 1 ? +(prob * 100).toFixed(2) : +prob.toFixed(2))
      : inferirProbImplicita(e?.cuota);
    return {
      ...e,
      probPct,
      mercadoKey: String(e?.mercado || "").toLowerCase().trim()
    };
  });
  scored.sort((a,b) => b.probPct - a.probPct);
  const out = [];
  for (const it of scored) {
    if (it.probPct < umbralPct) continue;
    if (it.mercadoKey && uniq.has(it.mercadoKey)) continue;
    uniq.add(it.mercadoKey);
    out.push(it);
    if (out.length >= maxN) break;
  }
  return out;
}

/* ============================ Top‑3 casas (orden/render) ============================ */
function top3ByPrice(uniqueOffers=[]) {
  const seen = new Set();
  const cleaned = (uniqueOffers || []).filter(o => Number.isFinite(o?.price) && o?.bookie)
    .sort((a,b) => b.price - a.price)
    .filter(o => {
      const key = String(o.bookie).toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    })
    .slice(0,3);
  return cleaned;
}
function renderTop3Lines(top3) {
  if (!Array.isArray(top3) || !top3.length) return "";
  const lines = top3.map((t,i)=>{
    const line = `${i+1}. ${t.bookie} — ${Number(t.price).toFixed(2)}`;
    return i===0 ? `**${line}**` : line;
  }).join("\n");
  return `🏆 Mejores 3 casas para apostar:\n${lines}`;
}

const TAGLINE = "🔎 Datos y cuotas verificados en tiempo real.";

/* ============================ Mensajes ============================ */
// Teaser (FREE + VIP)
function construirTeaserOutright({ torneo, temporada, diasRestantes }) {
  const dLabel = (diasRestantes >= 7 ? "1 semana" : `${diasRestantes} días`);
  return [
    `📡 RADAR DE VALOR — Apuesta a Futuro`,
    `${FLAG} ${torneo} ${temporada}`,
    `⏳ Falta ~${dLabel} para el inicio`,
    ``,
    `Se viene un pick premium de alto valor para campeón y mercados especiales.`,
    ``,
    `🔔 A ~24h del inicio publicaremos el PICK VIP con:`,
    `• EV y probabilidad estimada`,
    `• Apuestas extra (solo las de mayor probabilidad)`,
    `• Top 3 casas para apostar`,
    `• Datos clave: forma, lesiones, xG, transfers`,
    ``,
    TAGLINE,
    `Únete al VIP para recibirlo a tiempo.`
  ].join("\n");
}

// VIP final (24 ± 2h)
function construirMensajeOutrightVIP({ torneo, temporada, hleft, pick, probPct, ev, cuota, extrasFiltradas, top3 }) {
  const american = decimalToAmerican(cuota);
  const extrasBlock = (extrasFiltradas && extrasFiltradas.length)
    ? ["📋 Apuestas extra (máxima probabilidad):",
       ...extrasFiltradas.map(e => `- ${e.descripcion} (prob. ${e.probPct}%)`)].join("\n")
    : "📋 Apuestas extra: —";

  const top3Block = renderTop3Lines(top3);

  return [
    `🎯 APUESTA A FUTURO — ${ev >= 40 ? "🟣 Ultra Élite" : ev >= 30 ? "🎯 Élite Mundial" : ev >= 20 ? "🥈 Avanzado" : "🥉 Competitivo"}`,
    `${FLAG} ${torneo} ${temporada}`,
    `⏳ Inicia en ~${Math.max(0, hleft)} horas`,
    ``,
    `EV: ${ev.toFixed(0)}% | Probabilidad: ${probPct.toFixed(0)}% | Momio: ${american}`,
    ``,
    `💡 Apuesta sugerida: ${pick.apuesta}`,
    ``,
    extrasBlock,
    ``,
    top3Block,
    ``,
    `📊 Datos a considerar:`,
    `- ${pick.analisis_vip || "s/d"}`,
    ``,
    TAGLINE,
    `⚠️ Apuesta responsable. Este contenido es informativo; ninguna apuesta es segura.`
  ].filter(Boolean).join("\n");
}

// FREE final (si EV 10–14.9)
function construirMensajeOutrightFREE({ torneo, temporada, hleft, pick }) {
  return [
    `📡 RADAR DE VALOR — Apuesta a Futuro`,
    `${FLAG} ${torneo} ${temporada}`,
    `⏳ Inicia en ~${Math.max(0, hleft)} horas`,
    ``,
    `${pick.analisis_gratuito || "Análisis disponible en el VIP."}`,
    ``,
    TAGLINE,
    `Únete al VIP para recibir el pick completo con EV, probabilidad, apuestas extra y datos avanzados.`
  ].join("\n");
}

/* ============================ Handler ============================ */
exports.handler = async (event, context) => {
  assertEnv();

  const started = Date.now();
  const resumen = {
    torneos: 0, teaser_enviados: 0, finales_enviados_vip: 0, finales_enviados_free: 0,
    oai_calls: 0, guardados_ok: 0, guardados_fail: 0
  };

  // Lock simple por invocación
  if (global.__punterx_out_lock) {
    console.warn("[OUT] LOCK activo, salto ciclo");
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }
  global.__punterx_out_lock = true;

  try {
    // 1) Obtener torneos y mercados OUTRIGHTS (OddsAPI + API‑FOOTBALL)
    const torneos = await fetchOutrights();
    resumen.torneos = Array.isArray(torneos) ? torneos.length : 0;
    if (!resumen.torneos) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, resumen }) };
    }

    for (const T of torneos) {
      const torneoClave = T.torneoClave || `${T.pais || "INT"}:${T.liga || "Torneo"}:${T.temporada || "s/d"}`;
      const liga = T.liga || "Torneo";
      const temporada = T.temporada || "s/d";
      const hleft = hoursUntilISO(T.startsAtISO);
      const dleft = daysUntilISO(T.startsAtISO);

      const enTeaser = (dleft >= TEASER_D_MIN && dleft <= TEASER_D_MAX);
      const enFinal  = (hleft >= FINAL_H_MIN  && hleft <= FINAL_H_MAX);

      // 2) Teaser (FREE + VIP), una sola vez por torneo/temporada
      if (enTeaser) {
        const yaTeaser = await existsPickForTournament(supabase, torneoClave, OUTRIGHT_TYPES.TEASER);
        if (!yaTeaser) {
          const textoTeaser = construirTeaserOutright({ torneo: liga, temporada, diasRestantes: dleft });
          await enviarFREE(textoTeaser);

          // Teaser VIP
          const teaserVIP = [
            `🎯 AVISO VIP — Outright`,
            `${FLAG} ${liga} ${temporada}`,
            `⏳ Falta ~${dleft >= 7 ? "1 semana" : `${dleft} días`}`,
            ``,
            `El pick VIP (campeón y extras con mayor probabilidad) saldrá a ~24h del inicio con EV, probabilidad y Top 3 casas para apostar.`,
            ``,
            TAGLINE
          ].join("\n");
          await enviarVIP(teaserVIP);

          const ok = await guardarPickSupabaseOutright({
            torneoClave, texto: textoTeaser, pick: null, probPct: 0, ev: 0, nivel: "Informativo", tipo: OUTRIGHT_TYPES.TEASER, liga
          });
          if (ok) resumen.guardados_ok++; else resumen.guardados_fail++;
          resumen.teaser_enviados++;
        }
      }

      // 3) Pick final (24 ± 2h)
      if (enFinal) {
        const yaFinal = await existsPickForTournament(supabase, torneoClave, OUTRIGHT_TYPES.FINAL);
        if (yaFinal) continue;

        // Construir opciones del mercado principal (p.ej. Campeón) + extras
        const markets = Array.isArray(T.markets) ? T.markets : [];
        const opciones = construirOpcionesOutrights(markets);

        // Prompt IA
        const prompt = construirPromptOutright(T, markets, []); // puedes incluir memoria si la agregas
        resumen.oai_calls++;
        const { pick } = await obtenerPickConFallback(prompt);

        if (esNoPick(pick)) continue;
        if (!pickCompleto(pick)) continue;

        // Seleccionar precio para la apuesta principal
        const apuestaTxt = String(pick.apuesta || "");
        const match = markets.find(m => {
          const human = `${m.market}: ${m.label} — cuota ${m.price} (${m.bookie})`;
          return human === apuestaTxt;
        });
        if (!match) { console.warn("[OUT] No se encontró cuota para la apuesta:", apuestaTxt); continue; }

        const cuota = Number(match.price);
        const impl = impliedProbPct(cuota);

        // Prob IA (%)
        let probPct = null;
        const pv = Number(pick.probabilidad);
        if (!Number.isNaN(pv)) probPct = (pv > 0 && pv < 1) ? +(pv*100).toFixed(2) : +pv.toFixed(2);

        if (probPct == null || probPct < PROB_MIN || probPct > PROB_MAX) { console.warn("[OUT] Prob fuera de rango", probPct); continue; }
        if (impl != null && Math.abs(probPct - impl) > GAP_MAX) { console.warn("[OUT] Gap > 15pp", {probPct, impl}); continue; }

        const ev = calcularEV(probPct, cuota);
        if (ev == null) continue;
        if (ev < EV_MIN_SAVE) continue; // no guardar

        // Top‑3 para el mercado principal (Outright)
        const top3 = top3ByPrice(markets.filter(m =>
          String(m.market).toLowerCase().trim() === "outright"
        ));

        // Extras (filtradas por prob alta)
        const extrasCrudas = Array.isArray(T.extrasSugeridas) ? T.extrasSugeridas : []; // [{mercado, descripcion, probabilidad, cuota}]
        const extrasFiltradas = filtrarApuestasExtra(extrasCrudas, { umbralPct: EXTRA_UMBRAL_PCT, maxN: EXTRA_MAX });

        // Mensajes
        if (ev >= EV_MIN_VIP) {
          const msgVIP = construirMensajeOutrightVIP({
            torneo: liga, temporada, hleft, pick, probPct, ev, cuota, extrasFiltradas, top3
          });
          const okSend = await enviarVIP(msgVIP);
          if (okSend) {
            const ok = await guardarPickSupabaseOutright({
              torneoClave, texto: msgVIP, pick, probPct, ev, nivel:
                ev >= 40 ? "🟣 Ultra Élite" : ev >= 30 ? "🎯 Élite Mundial" : ev >= 20 ? "🥈 Avanzado" : "🥉 Competitivo",
              tipo: OUTRIGHT_TYPES.FINAL, liga
            });
            if (ok) resumen.guardados_ok++; else resumen.guardados_fail++;
            resumen.finales_enviados_vip++;
          }
        } else {
          const msgFREE = construirMensajeOutrightFREE({ torneo: liga, temporada, hleft, pick });
          const okSend = await enviarFREE(msgFREE);
          if (okSend) {
            const ok = await guardarPickSupabaseOutright({
              torneoClave, texto: msgFREE, pick, probPct, ev, nivel: "Informativo",
              tipo: OUTRIGHT_TYPES.FINAL, liga
            });
            if (ok) resumen.guardados_ok++; else resumen.guardados_fail++;
            resumen.finales_enviados_free++;
          }
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, resumen }) };

  } catch (e) {
    console.error("[OUT] Error ciclo:", e?.message || e);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  } finally {
    global.__punterx_out_lock = false;
    console.log("[OUT] Resumen:", JSON.stringify(resumen));
    console.log(`[OUT] Duration: ${(Date.now()-started).toFixed(2)} ms  RSS: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
  }
};
