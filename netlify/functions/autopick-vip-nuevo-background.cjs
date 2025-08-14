// netlify/functions/autopick-vip-nuevo-background.cjs
// PunterX · Autopick VIP — Background Runner (Optimizado)
// - Mismo pipeline que el autopick principal, ejecutado vía CRON (netlify.toml).
// - Logs estructurados, manejo de errores por etapa, sin telemetría.
// - VIP sin frase motivacional; FREE con frase.
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
    try { console.error(JSON.stringify({ lvl:"FATAL", scope:"process", msg:"uncaughtException", err: e && (e.stack || e.message || e) })); } catch {}
  });
  process.on("unhandledRejection", (e) => {
    try { console.error(JSON.stringify({ lvl:"FATAL", scope:"process", msg:"unhandledRejection", err: e && (e.stack || e.message || e) })); } catch {}
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
  TELEGRAM_CHANNEL_ID, // FREE (canal)
  TELEGRAM_GROUP_ID,   // VIP (grupo)
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK,
  WINDOW_MAIN_MIN,
  WINDOW_MAIN_MAX,
  WINDOW_FB_MIN,
  WINDOW_FB_MAX,
  PREFILTER_MIN_BOOKIES,
  MAX_PER_CYCLE,
  SOFT_BUDGET_MS,
  MAX_OAI_CALLS_PER_CYCLE,
  COUNTRY_FLAG,
} = process.env;

/* ============================ Constantes ============================ */
const MODEL = OPENAI_MODEL || "gpt-5-mini";
const MODEL_FALLBACK = OPENAI_MODEL_FALLBACK || "gpt-5";
const WIN_MAIN_MIN = Number(WINDOW_MAIN_MIN || 40);
const WIN_MAIN_MAX = Number(WINDOW_MAIN_MAX || 55);
const WIN_FB_MIN   = Number(WINDOW_FB_MIN   || 35);
const WIN_FB_MAX   = Number(WINDOW_FB_MAX   || 70);
const PREF_MIN_BOOKIES = Number(PREFILTER_MIN_BOOKIES || 2);
const MAX_CANDIDATOS   = Number(MAX_PER_CYCLE || 50);
const BUDGET_MS        = Number(SOFT_BUDGET_MS || 70000);
const MAX_OAI          = Number(MAX_OAI_CALLS_PER_CYCLE || 40);
const FLAG             = COUNTRY_FLAG || "🌍";
const PICK_TABLE       = "picks_historicos";

/* ============================ Assert ENV ============================ */
function assertEnv() {
  const required = [
    "SUPABASE_URL","SUPABASE_KEY","OPENAI_API_KEY","TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID","TELEGRAM_GROUP_ID","ODDS_API_KEY","API_FOOTBALL_KEY"
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error("Variables de entorno faltantes: " + missing.join(", "));
  }
}

/* ============================ Clientes ============================ */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ============================ Logger Estructurado ============================ */
function log(lvl, scope, msg, meta) {
  const rec = { t: new Date().toISOString(), lvl, scope, msg };
  if (meta && typeof meta === "object") Object.assign(rec, meta);
  const line = JSON.stringify(rec);
  if (lvl === "ERROR" || lvl === "FATAL" || lvl === "WARN") console.error(line);
  else console.log(line);
}

/* ============================ Utils ============================ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ""; } }
function nowISO() { return new Date().toISOString(); }
function minutesUntilISO(iso) { const t = Date.parse(iso); return Math.round((t - Date.now())/60000); }
function formatMinAprox(mins) {
  if (mins == null) return "Comienza pronto";
  if (mins < 0) return `Ya comenzó (hace ${Math.abs(mins)} min)`;
  return `Comienza en ~${mins} min`;
}
function normalizeStr(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
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

/* ============================ HTTP con Retry ============================ */
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

/* ============================ Mercados y selección ============================ */
function arrBest(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.reduce((mx, o) => (o?.price > (mx?.price || -Infinity) ? o : mx), null);
}
function inferMarketFromApuesta(apuestaText) {
  const t = String(apuestaText || "").toLowerCase();
  if (t.includes("más de") || t.includes("over"))  return { market: "totals", side: "over"  };
  if (t.includes("menos de")|| t.includes("under")) return { market: "totals", side: "under" };
  if (t.includes("hándicap") || t.includes("handicap") || t.includes("spread")) return { market: "spreads", side: null };
  return { market: "h2h", side: null };
}
function top3ForSelectedMarket(partido, apuestaText) {
  const info = inferMarketFromApuesta(apuestaText);
  let arr = [];
  const offers = partido?.marketsOffers || {};
  if (info.market === "totals") {
    arr = info.side === "over" ? (offers.totals_over || []) : (offers.totals_under || []);
  } else if (info.market === "spreads") {
    arr = offers.spreads || [];
  } else {
    arr = offers.h2h || [];
  }
  const seen = new Set();
  return arr.filter(o => Number.isFinite(o?.price))
    .sort((a,b) => b.price - a.price)
    .filter(o => {
      const key = (o?.bookie || "").toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    })
    .slice(0,3)
    .map(o => ({ bookie: o.bookie, price: Number(o.price), point: (typeof o.point !== "undefined" ? o.point : null) }));
}
function seleccionarCuotaSegunApuesta(partido, apuesta) {
  const t = String(apuesta || "").toLowerCase();
  const m = partido?.marketsBest || {};
  let selected = null;

  if (t.includes("más de") || t.includes("over") || t.includes("total")) {
    if (m.totals && m.totals.over) selected = { valor: m.totals.over.valor, label: "over", point: m.totals.over.point };
    else return null;
  } else if (t.includes("menos de") || t.includes("under")) {
    if (m.totals && m.totals.under) selected = { valor: m.totals.under.valor, label: "under", point: m.totals.under.point };
    else return null;
  } else if (t.includes("hándicap") || t.includes("handicap") || t.includes("spread")) {
    if (m.spreads) selected = { valor: m.spreads.valor, label: m.spreads.label, point: m.spreads.point };
    else return null;
  } else {
    if (m.h2h) selected = { valor: m.h2h.valor, label: m.h2h.label };
    else return null;
  }

  const top3 = top3ForSelectedMarket(partido, apuesta);
  return { ...selected, top3 };
}
function apuestaCoincideConOutcome(apuestaTxt, outcomeTxt, homeTeam, awayTeam) {
  const a = normalizeStr(apuestaTxt || "");
  const o = normalizeStr(outcomeTxt || "");
  const home = normalizeStr(homeTeam || "");
  const away = normalizeStr(awayTeam || "");

  const esHome  = a.includes("1x2: local") || a.includes("local") || a.includes(home);
  const esVisit = a.includes("1x2: visitante") || a.includes("visitante") || a.includes(away);
  if (o.includes("draw") || o.includes("empate")) return a.includes("empate") || a.includes("draw");
  if (esHome && (o.includes(away) || o.includes("away"))) return false;
  if (esVisit && (o.includes(home) || o.includes("home"))) return false;
  return true;
}

/* ============================ Mensajería (formatos) ============================ */
function decimalToAmerican(d) {
  const dec = Number(d);
  if (!Number.isFinite(dec) || dec <= 1) return "n/d";
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}
const TAGLINE = "🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.";

function construirMensajeVIP(partido, pick, probPct, ev, nivel, cuotaInfo, infoExtra) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const top3Arr = Array.isArray(cuotaInfo?.top3) ? cuotaInfo.top3 : [];
  const american = decimalToAmerican(cuotaInfo?.valor);

  const top3Text = top3Arr.length
    ? [
        "🏆 Mejores 3 casas de apuestas para este partido:",
        ...top3Arr.map((b,i) => {
          const line = `${i+1}. ${b.bookie} — ${Number(b.price).toFixed(2)}`;
          return (i === 0) ? `**${line}**` : line;
        })
      ].join("\n")
    : "";

  const datos = [];
  if (infoExtra?.clima)   datos.push(`- Clima: ${typeof infoExtra.clima === "string" ? infoExtra.clima : "disponible"}`);
  if (infoExtra?.arbitro) datos.push(`- Árbitro: ${infoExtra.arbitro}`);
  if (infoExtra?.estadio) datos.push(`- Estadio: ${infoExtra.estadio}${infoExtra?.ciudad ? ` (${infoExtra.ciudad})` : ""}`);
  const datosBlock = datos.length ? `\n📊 Datos a considerar:\n${datos.join("\n")}` : "";

  const encabezadoNivel = nivel ? ` ${nivel}` : "";
  return [
    `🎯 PICK NIVEL:${encabezadoNivel}`,
    `${FLAG} ${partido.liga}`,
    `⏱️ ${formatMinAprox(mins)}`,
    `EV: ${ev.toFixed(0)}% | Posibilidades de acierto: ${probPct.toFixed(0)}% | Momio: ${american}`,
    ``,
    `💡 Apuesta sugerida: ${pick.apuesta}`,
    ``,
    `📋 Apuestas extra:`,
    ...(pick.apuestas_extra ? pick.apuestas_extra.split(/\r?\n/).filter(Boolean).map(x=>`- ${x.trim()}`) : ["- —"]),
    top3Text ? `\n${top3Text}` : "",
    datosBlock,
    ``,
    TAGLINE,
    ``,
    `⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.`
  ].filter(Boolean).join("\n");
}

function construirMensajeFREE(partido, pick) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const motiv = String(pick.frase_motivacional || "").trim();
  return [
    `📡 RADAR DE VALOR`,
    `${FLAG} ${partido.liga}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `${pick.analisis_gratuito}`,
    motiv ? `\n💬 “${motiv}”\n` : "",
    `⏳ Quedan menos de ${Math.max(1, mins)} minutos para este encuentro, no te lo pierdas.`,
    ``,
    TAGLINE,
    ``,
    `Únete al VIP para recibir el pick completo con EV, probabilidad, apuestas extra y datos avanzados.`
  ].filter(Boolean).join("\n");
}

/* ============================ Normalización OddsAPI ============================ */
function normalizeOddsEvent(evento) {
  try {
    const id = evento?.id || evento?.event_id || `${evento?.commence_time}-${evento?.home_team}-${evento?.away_team}`;
    const commence_time = evento?.commence_time;
    const mins = minutesUntilISO(commence_time);

    const offers = Array.isArray(evento?.bookmakers) ? evento.bookmakers : [];
    const marketsOutcomes = { h2h: [], totals_over: [], totals_under: [], spreads: [] };
    for (const b of offers) {
      const bookie = b?.title || b?.key || "";
      for (const mk of (b?.markets || [])) {
        const mkey = String(mk?.key || "").toLowerCase();
        const outcomes = Array.isArray(mk?.outcomes) ? mk.outcomes : [];
        if (mkey === "h2h") {
          for (const o of outcomes) marketsOutcomes.h2h.push({ bookie, name: o.name, price: Number(o.price) });
        } else if (mkey === "totals") {
          for (const o of outcomes) {
            const side = (o?.name || "").toLowerCase().includes("over") ? "over" : "under";
            const point = Number(o?.point);
            if (side === "over") marketsOutcomes.totals_over.push({ bookie, price: Number(o.price), point });
            else marketsOutcomes.totals_under.push({ bookie, price: Number(o.price), point });
          }
        } else if (mkey === "spreads") {
          for (const o of outcomes) marketsOutcomes.spreads.push({ bookie, price: Number(o.price), point: Number(o?.point), name: o.name });
        }
      }
    }

    const bestH2H    = arrBest(marketsOutcomes.h2h);
    const bestTotOver= arrBest(marketsOutcomes.totals_over);
    const bestTotUnder=arrBest(marketsOutcomes.totals_under);
    const bestSpread = arrBest(marketsOutcomes.spreads);

    return {
      id,
      commence_time,
      minutosFaltantes: mins,
      home: evento?.home_team || "",
      away: evento?.away_team || "",
      liga: evento?.league || evento?.sport_title || "(por confirmar)",
      marketsBest: {
        h2h: bestH2H ? { valor: bestH2H.price, label: bestH2H.name } : null,
        totals: {
          over:  bestTotOver  ? { valor: bestTotOver.price,  point: bestTotOver.point }   : null,
          under: bestTotUnder ? { valor: bestTotUnder.price, point: bestTotUnder.point } : null
        },
        spreads: bestSpread ? { valor: bestSpread.price, label: bestSpread.name, point: bestSpread.point } : null
      },
      marketsOffers: {
        h2h: marketsOutcomes.h2h,
        totals_over: marketsOutcomes.totals_over,
        totals_under: marketsOutcomes.totals_under,
        spreads: marketsOutcomes.spreads
      },
      sport_title: evento?.sport_title || ""
    };
  } catch (e) {
    log("ERROR","normalizeOddsEvent","exception", { err: e?.message || e });
    return null;
  }
}

function scorePreliminar(p) {
  let score = 0;
  const set = new Set([...(p.marketsOffers?.h2h||[]), ...(p.marketsOffers?.totals_over||[]),
    ...(p.marketsOffers?.totals_under||[]), ...(p.marketsOffers?.spreads||[])]
    .map(x => (x?.bookie||"").toLowerCase()).filter(Boolean));
  if (set.size >= PREF_MIN_BOOKIES) score += 20;

  const hasH2H = (p.marketsOffers?.h2h||[]).length > 0;
  const hasTotals = (p.marketsOffers?.totals_over||[]).length > 0 && (p.marketsOffers?.totals_under||[]).length > 0;
  const hasSpread = (p.marketsOffers?.spreads||[]).length > 0;
  if (hasH2H) score += 15;
  if (hasTotals) score += 10;
  if (hasSpread) score += 5;

  if (Number.isFinite(p.minutosFaltantes) && p.minutosFaltantes >= WIN_MAIN_MIN && p.minutosFaltantes <= WIN_MAIN_MAX) {
    score += 10;
  }
  return score;
}

/* ============================ API-FOOTBALL ============================ */
async function enriquecerPartidoConAPIFootball(p) {
  try {
    if (!p?.home || !p?.away) return {};
    const q = `${p.home} ${p.away}`;
    const url = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(q)}`;
    const res = await fetchWithRetry(url, { headers: { "x-apisports-key": API_FOOTBALL_KEY } }, { retries: 1, base: 400 });
    if (!res || !res.ok) {
      log("WARN","api-football","http not ok", { status: res?.status, text: await safeText(res) });
      return {};
    }
    const data = await safeJson(res);
    if (!data?.response || !data.response.length) {
      log("WARN","api-football","no matches", { query: q }); return {};
    }
    const fixture = data.response[0];
    return {
      fixture_id: fixture?.fixture?.id || null,
      fecha: fixture?.fixture?.date || null,
      estadio: fixture?.fixture?.venue?.name || null,
      ciudad: fixture?.fixture?.venue?.city || null,
      arbitro: fixture?.fixture?.referee || null,
      clima: fixture?.fixture?.weather || null
    };
  } catch (e) {
    log("ERROR","api-football","exception", { err: e?.message || e });
    return {};
  }
}

/* ============================ Memoria (Supabase) ============================ */
async function obtenerMemoriaSimilar(p) {
  try {
    const { data, error } = await supabase
      .from(PICK_TABLE)
      .select("evento, analisis, apuesta, tipo_pick, liga, equipos, ev, probabilidad, nivel, timestamp")
      .order("timestamp", { ascending: false })
      .limit(30);
    if (error) { log("WARN","memoria","supabase error", { err: error.message }); return []; }
    const rows = Array.isArray(data) ? data : [];
    const liga = (p?.liga || "").toLowerCase();
    const home = (p?.home || "").toLowerCase();
    const away = (p?.away || "").toLowerCase();

    const out = [];
    for (const r of rows) {
      const lg = (r?.liga || "").toLowerCase();
      const eq = (r?.equipos || "").toLowerCase();
      const okLiga = liga && lg && (lg.includes(liga.split("—")[0].trim()) || lg.includes(liga.split("-")[0].trim()));
      const okEquipo = (home && eq.includes(home)) || (away && eq.includes(away));
      if (okLiga && okEquipo) out.push(r);
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) {
    log("WARN","memoria","exception", { err: e?.message || e });
    return [];
  }
}

/* ============================ OpenAI ============================ */
function buildOpenAIPayload(model, prompt, maxOut=450) {
  const m = String(model || "").toLowerCase();
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);
  const base = {
    model,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
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
    frase_motivacional: p.frase_motivacional ?? "s/d", // SOLO FREE
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
function esNoPick(p) { return !!p && p.no_pick === true; }
function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta && typeof p.probabilidad === "number");
}
async function pedirPickConModelo(modelo, prompt) {
  const t0 = Date.now();
  const completion = await openai.chat.completions.create(buildOpenAIPayload(modelo, prompt, 450));
  log("INFO","openai","completion ok", { model: modelo, ms: Date.now()-t0 });
  const raw = completion?.choices?.[0]?.message?.content || "";
  let obj = extractFirstJsonBlock(raw);
  if (!obj) {
    try { obj = await repairPickJSON(modelo, raw); }
    catch(e){ log("WARN","openai","repair failed", { err: e?.message || e }); }
  }
  if (!obj) return null;
  return ensurePickShape(obj);
}
async function obtenerPickConFallback(prompt) {
  let pick = await pedirPickConModelo(MODEL, prompt);
  if (esNoPick(pick)) return { pick, modeloUsado: MODEL };
  if (!pickCompleto(pick)) {
    log("INFO","openai","fallback model", { from: MODEL, to: MODEL_FALLBACK });
    pick = await pedirPickConModelo(MODEL_FALLBACK, prompt);
    return { pick, modeloUsado: MODEL_FALLBACK };
  }
  return { pick, modeloUsado: MODEL };
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
  const rx = /^\s*(?:#+\s*)?1\)\s*Pre[ -‑]match\b[\s\S]*?(?=^\s*(?:#+\s*)?\d+\)\s|\Z)/mi;
  const m = md.match(rx);
  if (!m) return null;
  return m[0].trim();
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
function construirOpcionesApostables(mejores) {
  if (!Array.isArray(mejores)) return [];
  return mejores.map(m => {
    const etiqueta =
      m.marketLabel && m.outcomeLabel
        ? `${m.marketLabel}: ${m.outcomeLabel}`
        : (m.outcomeLabel || m.marketLabel || "").trim();
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
    const rendered = renderTemplateWithMarkers(tpl, { contexto, opcionesList: opciones_apostables });
    if (rendered && rendered.length > 0) return rendered;
  }

  // Fallback embebido
  const prompt = [
    `Eres un analista de apuestas experto. Devuelve SOLO un JSON EXACTO con esta forma:`,
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
    `- Si "no_pick" = true ⇒ se permite que "apuesta" esté vacía y "probabilidad" = 0.0.`,
    `- Responde SOLO el JSON sin texto adicional.`,
    ``,
    JSON.stringify(contexto),
    ``,
    `opciones_apostables (elige UNA y pégala EXACTA en "apuesta"):`,
    ...opciones_apostables.map((s, i) => `${i+1}) ${s}`)
  ].join("\n");

  return prompt;
}

/* ============================ Supabase SAVE ============================ */
async function guardarPickSupabase(partido, pick, probPct, ev, nivel, cuota, tipo) {
  try {
    const evento = `${partido.home} vs ${partido.away} (${partido.liga})`;
    const entrada = {
      evento,
      analisis: `${pick.analisis_gratuito}\n---\n${pick.analisis_vip}`,
      apuesta: pick.apuesta,
      tipo_pick: tipo,
      liga: partido.liga,
      equipos: `${partido.home} — ${partido.away}`,
      ev: ev,
      probabilidad: probPct,
      nivel: nivel,
      timestamp: nowISO()
    };
    const { error } = await supabase.from(PICK_TABLE).insert([entrada]);
    if (error) { log("ERROR","supabase","insert fail", { err: error.message }); return false; }
    return true;
  } catch (e) {
    log("ERROR","supabase","insert exception", { err: e?.message || e });
    return false;
  }
}

/* ============================ Telegram ============================ */
async function enviarTelegram(chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { retries: 2, base: 600 });
    if (!res.ok) { log("ERROR","telegram","http not ok", { status: res.status, text: await safeText(res) }); return false; }
    return true;
  } catch (e) {
    log("ERROR","telegram","net exception", { err: e?.message || e });
    return false;
  }
}
const enviarFREE = (text) => enviarTelegram(TELEGRAM_CHANNEL_ID, text);
const enviarVIP  = (text) => enviarTelegram(Number(TELEGRAM_GROUP_ID), text);

/* ============================ Handler ============================ */
exports.handler = async (event, context) => {
  const started = Date.now();
  try { assertEnv(); }
  catch (e) {
    log("FATAL","env","missing env", { err: e?.message || e });
    return { statusCode: 200, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  }

  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0, oai_calls: 0
  };

  // Lock simple por invocación
  if (global.__punterx_bg_lock) {
    log("WARN","runtime","lock active, skipping");
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }
  global.__punterx_bg_lock = true;

  const abortIfOverBudget = () => {
    const elapsed = Date.now() - started;
    if (elapsed > BUDGET_MS) throw new Error("Soft budget excedido");
  };

  try {
    log("INFO","start","cycle", { win:`${WIN_MAIN_MIN}-${WIN_MAIN_MAX}`, fb:`${WIN_FB_MIN}-${WIN_FB_MAX}` });

    // 1) OddsAPI
    const base = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&oddsFormat=decimal&markets=h2h,totals,spreads`;
    const url = `${base}&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithRetry(url, { method: "GET" }, { retries: 1, base: 400 });
    if (!res || !res.ok) {
      log("ERROR","oddsapi","http not ok", { status: res?.status, text: await safeText(res) });
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "oddsapi" }) };
    }
    const eventos = await safeJson(res) || [];
    resumen.recibidos = Array.isArray(eventos) ? eventos.length : 0;

    // 2) Normalizar + ventana
    const partidos = (eventos || []).map(normalizeOddsEvent).filter(Boolean);
    const inWindow = partidos.filter(p => {
      const mins = Math.round(p.minutosFaltantes);
      const principal = mins >= WIN_MAIN_MIN && mins <= WIN_MAIN_MAX;
      const fallback  = !principal && mins >= WIN_FB_MIN && mins <= WIN_FB_MAX;
      return principal || fallback;
    });
    resumen.enVentana = inWindow.length;
    if (!inWindow.length) {
      log("INFO","window","no matches");
      return { statusCode: 200, body: JSON.stringify({ ok: true, resumen }) };
    }

    // 3) Prefiltro (prioriza, no descarta)
    const candidatos = inWindow.sort((a,b) => scorePreliminar(b) - scorePreliminar(a)).slice(0, MAX_CANDIDATOS);
    resumen.candidatos = candidatos.length;
    log("INFO","prefilter","candidates", { total: candidatos.length });

    // 4) Loop de proceso
    for (const P of candidatos) {
      abortIfOverBudget();
      const trace = { evt: P.id, match: `${P.home} vs ${P.away}`, liga: P.liga };
      try {
        // Enriquecimiento
        const info = await enriquecerPartidoConAPIFootball(P) || {};
        // Memoria
        const memoria = await obtenerMemoriaSimilar(P);
        // Prompt
        const prompt = construirPrompt(P, info, memoria);

        // OpenAI (con fallback y límite)
        if (resumen.oai_calls >= MAX_OAI) { log("WARN","openai","max calls reached"); break; }
        resumen.oai_calls++;
        const { pick, modeloUsado } = await obtenerPickConFallback(prompt);
        if (!pick) { log("WARN","oai","null pick", trace); continue; }
        if (esNoPick(pick)) { log("INFO","oai","no_pick", { ...trace, motivo: pick?.motivo_no_pick || "s/d" }); continue; }
        if (!pickCompleto(pick)) { log("WARN","oai","incomplete pick", trace); continue; }

        // Cuota exacta del mercado solicitado
        const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
        if (!cuotaSel || !cuotaSel.valor) { log("WARN","market","no matching price", trace); continue; }
        const cuota = Number(cuotaSel.valor);

        // Coherencia apuesta/outcome
        const outcomeTxt = String(cuotaSel.label || P?.marketsBest?.h2h?.label || "");
        if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, P.home, P.away)) {
          log("WARN","market","apuesta/outcome mismatch", { ...trace, apuesta: pick.apuesta, outcome: outcomeTxt }); continue;
        }

        // Probabilidad y gap con implícita
        let probPct = null;
        if (typeof pick.probabilidad !== "undefined") {
          const v = Number(pick.probabilidad);
          if (!Number.isNaN(v)) probPct = (v > 0 && v < 1) ? +(v*100).toFixed(2) : +v.toFixed(2);
        }
        if (probPct == null || probPct < 5 || probPct > 85) { log("WARN","prob","out of range 5–85", { ...trace, probPct }); continue; }
        const impl = impliedProbPct(cuota);
        if (impl != null && Math.abs(probPct - impl) > 15) {
          log("WARN","prob","gap > 15pp", { ...trace, probPct, impl }); continue;
        }

        const ev = calcularEV(probPct, cuota);
        if (ev == null) { log("WARN","ev","null", trace); continue; }
        resumen.procesados++;
        if (ev < 10) { resumen.descartados_ev++; log("INFO","ev","discard <10", { ...trace, ev }); continue; }

        const nivel = ev >= 40 ? "🟣 Ultra Élite"
                    : ev >= 30 ? "🎯 Élite Mundial"
                    : ev >= 20 ? "🥈 Avanzado"
                    : ev >= 15 ? "🥉 Competitivo"
                    : "Informativo";

        const cuotaInfo = { ...cuotaSel, top3: top3ForSelectedMarket(P, pick.apuesta) };
        const destinoVIP = (ev >= 15);

        if (destinoVIP) {
          resumen.intentos_vip++;
          const msgVIP = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo, info);
          const ok = await enviarVIP(msgVIP);
          if (ok) { resumen.enviados_vip++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, "VIP"); }
          log(ok ? "INFO" : "WARN","send","vip", { ...trace, ok });
        } else {
          resumen.intentos_free++;
          const msgFREE = construirMensajeFREE(P, pick);
          const ok = await enviarFREE(msgFREE);
          if (ok) { resumen.enviados_free++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, "FREE"); }
          log(ok ? "INFO" : "WARN","send","free", { ...trace, ok });
        }

      } catch (e) {
        log("ERROR","loop","exception", { ...trace, err: e?.message || e });
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, resumen }) };

  } catch (e) {
    log("ERROR","cycle","exception", { err: e?.message || e });
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  } finally {
    global.__punterx_bg_lock = false;
    log("INFO","end","summary", { resumen });
    log("INFO","end","duration", { ms: Date.now() - started, rss_mb: Math.round(process.memoryUsage().rss/1e6) });
  }
};
