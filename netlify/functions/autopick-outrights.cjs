// netlify/functions/autopick-outrights.cjs
// PunterX · AUTOPICK OUTRIGHTS (Futures)
// - Descubre torneos con mercado 'outrights/winner' (OddsAPI) con control de liquidez/exclusiones
// - Genera pick VIP con EV (apuesta sugerida + extras si también tienen EV) o, si no hay valor, análisis FREE informativo
// - Guardrails: coherencia prob–cuota ±pp, EV mínimo, antiduplicado por selección
// - Robusto: lock de ciclo, circuit breaker, timeouts y reintentos
// - Mensaje incluye fecha de inicio del torneo (si se puede resolver)

// --- BLINDAJE RUNTIME: fetch + trampas globales (añadir al inicio del archivo) ---
try {
  if (typeof fetch === 'undefined') {
    // Polyfill para runtimes/lambdas donde fetch aún no está disponible
    global.fetch = require('node-fetch');
  }
} catch (_) { /* no-op */ }

try {
  // Evita “Internal Error” si algo revienta antes del handler
  process.on('uncaughtException', (e) => {
    try { console.error('[UNCAUGHT]', e && (e.stack || e.message || e)); } catch {}
  });
  process.on('unhandledRejection', (e) => {
    try { console.error('[UNHANDLED]', e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) { /* no-op */ }
// --- FIN BLINDAJE RUNTIME ---

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
// ⬇️ Migración a openai@4
const OpenAI = require('openai');

// [PX-CHANGE] imports para lectura del prompt desde MD
const fs = require('fs');                 // [PX-CHANGE]
const path = require('path');             // [PX-CHANGE]

/* ===========================
 *  ENV / Config
 * =========================== */
const {
  // Feature flags
  ENABLE_OUTRIGHTS = 'false',              // 'true' para activar el módulo
  ENABLE_OUTRIGHTS_INFO = 'true',          // si no hay valor, enviar análisis informativo (FREE)

  // Descubrimiento dinámico con control
  OUTRIGHTS_MIN_BOOKIES = '3',             // liquidez mínima por torneo
  OUTRIGHTS_MIN_OUTCOMES = '8',            // nº mínimo de selecciones
  OUTRIGHTS_EXCLUDE = '*u19*,*u20*,*friendly*,*reserves*,*...n*,*amateur*', // patrones a excluir (minúsculas, coma-separado)

  // Guardrails / Umbrales
  OUTRIGHTS_EV_MIN_VIP = '15',             // EV mínimo VIP (%)
  OUTRIGHTS_COHERENCE_MAX_PP = '15',       // |p_modelo - p_implícita| (pp)
  OUTRIGHTS_PROB_MIN = '5',                // % (IA)
  OUTRIGHTS_PROB_MAX = '85',               // % (IA)

  // OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-5-mini',
  OPENAI_MODEL_FALLBACK = 'gpt-5',

  // Datos
  SUPABASE_URL,
  SUPABASE_KEY,
  ODDS_API_KEY,
  API_FOOTBALL_KEY, // opcional, para estimar fecha de inicio

  // Telegram (VIP / FREE)
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_GROUP_ID,     // VIP
  TELEGRAM_CHANNEL_ID    // FREE informativo
} = process.env;

// Parámetros numéricos
const MIN_BOOKIES = Math.max(1, Number(OUTRIGHTS_MIN_BOOKIES) || 3);
const MIN_OUTCOMES = Math.max(1, Number(OUTRIGHTS_MIN_OUTCOMES) || 8);
const EV_MIN_VIP = Number(OUTRIGHTS_EV_MIN_VIP) || 15;
const COHERENCE_MAX_PP = Number(OUTRIGHTS_COHERENCE_MAX_PP) || 15;
const PROB_MIN = (Number(OUTRIGHTS_PROB_MIN) || 5) / 100;
const PROB_MAX = (Number(OUTRIGHTS_PROB_MAX) || 85) / 100;

// Conexiones
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const oai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ===========================
 *  Utilidades Generales
 * =========================== */
const FN_NAME = 'autopick-outrights';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn(...a);
const error = (...a) => console.error(...a);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}

async function endRun(run_id, patch = {}) {
  if (!run_id) return;
  try {
    await supabase.from('function_runs').update({
      finished_at: nowIso(),
      status: patch.status || 'ok',
      error: patch.error || null,
      summary: patch.summary || null,
      oai_calls: patch.oai_calls || 0,
      oai_ok: patch.oai_ok || 0,
    }).eq('run_id', run_id);
  } catch (e) {
    warn(`[diag][${FN_NAME}] endRun error:`, e?.message || e);
  }
}

/* ===========================
 *  Locks / KV
 * =========================== */
async function acquireLock(key = 'autopick-outrights', ttlSec = 180) {
  try {
    const until = new Date(Date.now() + ttlSec * 1000).toISOString();
    const { error: e } = await supabase.from('locks').insert({ k: key, ttl_until: until });
    if (!e) return true;
    const { data: row } = await supabase.from('locks').select('ttl_until').eq('k', key).maybeSingle();
    if (row && new Date(row.ttl_until).getTime() < Date.now()) {
      await supabase.from('locks').delete().eq('k', key);
      return acquireLock(key, ttlSec);
    }
    return false;
  } catch {
    return true; // fail-open
  }
}
async function releaseLock(key = 'autopick-outrights') {
  try { await supabase.from('locks').delete().eq('k', key); } catch {}
}

/* ===========================
 *  OddsAPI — Outrights
 * =========================== */
function impliedProb(price) {
  const q = Number(price);
  if (!Number.isFinite(q) || q <= 1.0) return null;
  return +(1 / q).toFixed(4); // decimal
}
function impliedProbPct(price) {
  const p = impliedProb(price);
  return p == null ? null : +(p * 100).toFixed(2);
}
function withinPP(modelPct, impliedPct, maxPP = 15) {
  if (!Number.isFinite(modelPct) || !Number.isFinite(impliedPct)) return false;
  return Math.abs(modelPct - impliedPct) <= maxPP;
}

function buildOpenAIPayload(model, prompt, maxOut = 450) {
  const m = String(model || '').toLowerCase();
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);

  const base = {
    model,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  };
  if (modern) base.max_completion_tokens = maxOut;
  else base.max_tokens = maxOut;

  // gpt-5 / o3: usa temperatura por defecto; para otros, bajamos un poco
  if (!/gpt-5|o3/.test(m)) base.temperature = 0.2;

  return base;
}

function extractFirstJsonBlock(text) {
  if (!text) return null;
  const s = String(text);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function ensureOutrightShape(p) {
  if (!p || typeof p !== 'object') p = {};
  // Incluimos 'probabilidad' para EV; extras opcionales (array de strings)
  return {
    analisis_vip: p.analisis_vip ?? 's/d',
    apuesta: p.apuesta ?? '',               // "Ganador: Inglaterra"
    apuestas_extra: p.apuestas_extra ?? '', // texto simple o bullets
    frase_motivacional: p.frase_motivacional ?? 's/d',
    probabilidad: typeof p.probabilidad === 'number' ? p.probabilidad : null,
    no_pick: p.no_pick === true,
    motivo_no_pick: p.motivo_no_pick ?? ''
  };
}
function esNoPick(p) { return !!p && p.no_pick === true; }

function pickCompleto(p) {
  if (!p || esNoPick(p)) return !esNoPick(p) ? false : true;
  return !!(p.analisis_vip && p.apuesta && typeof p.probabilidad === 'number');
}

/* ===========================
 *  Descubrimiento de candidatos
 * =========================== */
function matchExcluded(name = '') {
  const s = String(name || '').toLowerCase();
  const parts = String(OUTRIGHTS_EXCLUDE || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
  return parts.some(p => {
    const rx = new RegExp(p.replace(/\*/g, '.*'));
    return rx.test(s);
  });
}

function mapOutrightsData(data) {
  const out = [];
  if (!Array.isArray(data)) return out;

  for (const ev of data) {
    const torneo = String(ev?.league || ev?.sport_title || 'Torneo').replace(/\s+/g, ' ').trim();
    if (!torneo || matchExcluded(torneo)) continue;

    const bookmakers = Array.isArray(ev?.bookmakers) ? ev.bookmakers : [];
    if (bookmakers.length < MIN_BOOKIES) continue;

    const allOutcomes = {}; // name -> { name, bestPrice, books[] }
    for (const bk of bookmakers) {
      const markets = Array.isArray(bk?.markets) ? bk.markets : [];
      for (const mk of markets) {
        const key = String(mk?.key || '').toLowerCase();
        if (!/(outright|outrights|winner|futures)/.test(key)) continue;
        const outcomes = Array.isArray(mk?.outcomes) ? mk.outcomes : [];
        for (const o of outcomes) {
          const name = String(o?.name || '').trim();
          const price = Number(o?.price);
          if (!name || !Number.isFinite(price)) continue;
          if (!allOutcomes[name]) {
            allOutcomes[name] = { name, bestPrice: price, books: [bk?.title || ''] };
          } else {
            allOutcomes[name].books.push(bk?.title || '');
            if (price > allOutcomes[name].bestPrice) allOutcomes[name].bestPrice = price;
          }
        }
      }
    }

    const arr = Object.values(allOutcomes).sort((a,b)=> b.bestPrice - a.bestPrice);
    if (arr.length < MIN_OUTCOMES) continue;

    out.push({
      torneo,
      mercado: 'Ganador del torneo',
      outcomes: arr
    });
  }

  return out;
}

/* ===========================
 *  Prompt / IA
 * =========================== */

// [PX-CHANGE] util: buscar y leer sección “2) Outrights / Futures” desde prompts_punterx.md
function tryReadFile(filePath) {           // [PX-CHANGE]
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}                                          // [PX-CHANGE]

function loadPromptsSectionOutrights() {   // [PX-CHANGE]
  // Intentar múltiples rutas razonables (bundle Netlify puede mover archivos)
  const candidates = [
    path.join(__dirname, 'prompts_punterx.md'),
    path.join(__dirname, '..', 'prompts_punterx.md'),
    path.join(__dirname, '..', '..', 'prompts_punterx.md'),
    path.join(process.cwd(), 'prompts_punterx.md')
  ];
  let content = null;
  for (const p of candidates) {
    content = tryReadFile(p);
    if (content) break;
  }
  if (!content) return null;

  // extraer sección que inicia con "2) Outrights / Futures"
  const rx = /(^|\n)##?\s*2\)\s*Outrights\s*\/\s*Futures[\s\S]*?(?=\n##?\s*\d+\)|\n#|\Z)/i;
  const m = content.match(rx);
  if (!m) return null;
  // devolver bloque de esa sección
  return m[0];
}                                          // [PX-CHANGE]

// [PX-CHANGE] constructor que usa MD con fallback al embebido
function construirPromptOutright({ torneo, mercado, topOutcomes, memoriaLiga30d, fechaInicioISO }) {
  // 1) Intentar leer sección MD
  const section = loadPromptsSectionOutrights();  // [PX-CHANGE]

  // 2) Construir lista TOP outcomes “Nombre — cuota X (implícita Y%)”
  const list = Array.isArray(topOutcomes) ? topOutcomes.slice(0, 8).map((o, i) => {
    const name = String(o?.name || '').trim();
    const price = Number(o?.price);
    const imp = Number.isFinite(price) ? impliedProbPct(price) : null;
    return `${i + 1}) ${name} — cuota ${price} (implícita ${imp ?? 's/d'}%)`;
  }) : [];                                   // [PX-CHANGE]

  const FECHA = fechaInicioISO ? String(fechaInicioISO) : 's/d'; // [PX-CHANGE]
  const MEM = memoriaLiga30d ? String(memoriaLiga30d) : 's/d';   // [PX-CHANGE]

  if (section) {
    // 3) Sustituir marcadores en el texto MD
    let promptFromMD = section
      .replace(/\{\{TORNEO\}\}/g, String(torneo || 's/d'))
      .replace(/\{\{MERCADO\}\}/g, String(mercado || 's/d'))
      .replace(/\{\{FECHA_INICIO_ISO\}\}/g, FECHA)
      .replace(/\{\{TOP_OUTCOMES_LIST\}\}/g, list.join('\n'))
      .replace(/\{\{MEMORIA_LIGA_30D\}\}/g, MEM);

    // En caso de que la sección incluya títulos/markdown, intentamos quedarnos con el bloque de instrucciones
    // Conservamos íntegro; el guardrail de “Devuelve SOLO JSON …” debe estar en el MD.
    // Log discreto
    console.log(`[prompt][outrights] source=md len=${promptFromMD.length}`); // [PX-CHANGE]
    return promptFromMD.trim();
  }

  // 4) Fallback al prompt embebido actual (sin modificar guardrails)
  const lines = [];
  lines.push(`Eres un analista de apuestas experto. Devuelve SOLO un JSON con esta forma EXACTA:`);
  lines.push(`{`);
  lines.push(`  "analisis_vip": "",`);
  lines.push(`  "apuesta": "",                // ejemplo: "Ganador: Inglaterra"`);
  lines.push(`  "apuestas_extra": "",         // bullets o texto breve opcional`);
  lines.push(`  "frase_motivacional": "",`);
  lines.push(`  "probabilidad": 0.0           // decimal (0.05 a 0.85)`);
  lines.push(`  "no_pick": false,              // true si NO recomiendas apostar`);
  lines.push(`  "motivo_no_pick": ""           // breve justificación si no_pick=true`);
  lines.push(`}`);
  lines.push(`Reglas:`);
  lines.push(`- "probabilidad" es decimal (no %), rango 0.05–0.85.`);
  lines.push(`- "apuesta" debe referirse a una selección EXACTA de las listadas.`);
  lines.push(`- Sé claro y táctico en "analisis_vip" (3–5 líneas).`);
  lines.push(`- Si "no_pick"=true: no des apuesta; justifica en "motivo_no_pick".`);
  lines.push(`- "apuestas_extra" sugiere 0–3 ideas breves SOLO si también tienen valor potencial.`);
  lines.push(`Contexto:`);
  lines.push(`- Torneo: ${torneo}`);
  lines.push(`- Mercado: ${mercado}`);
  if (fechaInicioISO) lines.push(`- Fecha de inicio (estimada): ${fechaInicioISO}`);
  lines.push(`- Top cuotas (mejor por selección):`);
  topOutcomes.slice(0, 8).forEach((o, i) => {
    lines.push(`  ${i+1}) ${o.name} — cuota ${o.price} (implícita ${impliedProbPct(o.price)}%)`);
  });
  if (memoriaLiga30d) lines.push(`- Memoria 30d: ${memoriaLiga30d}`);
  lines.push(`Devuelve SOLO el JSON, sin comentarios.`);

  const fallbackPrompt = lines.join('\n');
  console.log(`[prompt][outrights] source=fallback len=${fallbackPrompt.length}`); // [PX-CHANGE]
  return fallbackPrompt;
} // [PX-CHANGE] fin constructor prompt

async function pedirOutrightConModelo(modelo, prompt) {
  // ⬇️ Migración a openai@4
  const completion = await oai.chat.completions.create(
    buildOpenAIPayload(modelo, prompt, 350)
  );
  const raw = completion?.choices?.[0]?.message?.content || '';
  const obj = extractFirstJsonBlock(raw);
  return obj ? ensureOutrightShape(obj) : null;
}

/* ===========================
 *  Mensajes
 * =========================== */
function mensajeFreeInformativo({ torneo, fechaInicioISO, analisis }) {
  const f = fechaInicioISO ? new Date(fechaInicioISO).toLocaleString() : 's/d';
  return [
    '📡 RADAR OUTRIGHT (Panorama del torneo)',
    `🏆 Torneo: ${torneo}`,
    `🗓️ Inicio estimado: ${f}`,
    '🧠 Análisis:',
    analisis || 's/d',
    '⚠️ Apuestas a largo plazo = mayor varianza. Juega responsable.'
  ].join('\n');
}

/* ===========================
 *  VIP Outright (mensaje)
 * =========================== */
function mensajeVipOutright({ torneo, mercado, seleccion, analisis_vip, frase, fechaInicioISO, apuestas_extra, ...pBooks }) {
  const f = fechaInicioISO ? new Date(fechaInicioISO).toLocaleString() : 's/d';
  const extras = (apuestas_extra && String(apuestas_extra).trim())
    ? `\n➕ Apuestas extra:\n${String(apuestas_extra)}`
    : '';
  return [
    '🎯 PICK OUTRIGHT',
    `🏆 Torneo: ${torneo}`,
    `🗓️ Inicio estimado: ${f}`,
    `🎯 Mercado: ${mercado}`,
    `✅ Selección: ${seleccion}`,
    `📈 Prob. estimada (IA): ${pBooks.probPct}%`,
    `💹 EV: ${pBooks.ev}%`,
    pBooks.topBooks?.length ? `🏦 Top 3 bookies: ${pBooks.topBooks.slice(0,3).join(' · ')}` : '',
    `🧠 ${analisis_vip}`,
    extras,
    `💬 ${frase}`,
    '',
    '⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.'
  ].filter(Boolean).join('\n');
}

/* ===========================
 *  Persistencia / antiduplicado
 * =========================== */
async function hayDupeNoMejora({ torneo, seleccion, bestPrice, ev }) {
  try {
    const { data } = await supabase.from('picks_outright').select('*').eq('torneo', torneo).eq('seleccion', seleccion).order('timestamp', { ascending: false }).limit(1);
    const prev = Array.isArray(data) && data[0] ? data[0] : null;
    if (!prev) return false;
    const improvePrice = prev.cuota ? ((bestPrice - prev.cuota) / prev.cuota) * 100 : 0;
    const improveEV = (Number.isFinite(ev) && Number.isFinite(prev.ev)) ? (ev - prev.ev) : 0;
    // solo enviar si mejora
    return !(improvePrice > 0.5 || improveEV > 1.0);
  } catch {
    return false;
  }
}

/* ===========================
 *  Procesamiento de candidato
 * =========================== */
async function procesarCandidato(item) {
  // Fecha de inicio (best-effort, opcional)
  const fechaInicioISO = await resolverFechaInicioTorneo(item.torneo).catch(()=>null);
  const memoriaLiga30d = await obtenerMemoriaLigaResumen(item.torneo).catch(()=>null);

  const prompt = construirPromptOutright({
    torneo: item.torneo,
    mercado: item.mercado,
    topOutcomes: item.outcomes.map(o => ({ name: o.name, price: o.bestPrice })),
    memoriaLiga30d,
    fechaInicioISO
  });

  // IA principal
  let modeloUsado = OPENAI_MODEL;
  let pick = await pedirOutrightConModelo(OPENAI_MODEL, prompt).catch(e => {
    warn('[outrights] OAI principal err:', e?.message || e);
    return null;
  });

  // Si IA decide no_pick, salimos sin reintentar
  if (pick && esNoPick(pick)) return { ok: false, reason: 'ai_no_pick' };

  // Fallback si falla o está incompleto
  if (!pick || !pickCompleto(pick)) {
    warn('♻️ Fallback de modelo →', OPENAI_MODEL_FALLBACK);
    modeloUsado = OPENAI_MODEL_FALLBACK;
    pick = await pedirOutrightConModelo(OPENAI_MODEL_FALLBACK, prompt).catch(e => {
      warn('[outrights] OAI fallback err:', e?.message || e);
      return null;
    });
  }
  if (!pick) return { ok: false, reason: 'json_vacio' };
  if (esNoPick(pick)) return { ok: false, reason: 'ai_no_pick' };
  if (!pickCompleto(pick)) return { ok: false, reason: 'pick_incompleto_fallback' };

  // Normalización
  let prob = Number(pick.probabilidad);
  if (!Number.isFinite(prob)) return { ok: false, reason: 'prob_invalida' };
  if (prob < PROB_MIN) prob = PROB_MIN;
  if (prob > PROB_MAX) prob = PROB_MAX;

  const apuesta = String(pick.apuesta || '');
  const seleccion = apuesta.split(':').pop()?.trim() || '';
  if (!seleccion) return { ok: false, reason: 'sin_seleccion' };

  const match = item.outcomes.find(o => o.name.toLowerCase() === seleccion.toLowerCase());
  if (!match) return { ok: false, reason: 'seleccion_no_en_outcomes' };

  const bestPrice = match.bestPrice;
  const impPct = impliedProbPct(bestPrice);             // implícita por cuota
  const probPct = +(prob * 100).toFixed(2);             // modelo en %
  const ev = +(((prob * bestPrice) - 1) * 100).toFixed(2); // EV en %

  // Guardrails
  if (!withinPP(probPct, impPct, COHERENCE_MAX_PP)) return { ok: false, reason: 'coherencia_prob_cuota' };
  if (!Number.isFinite(ev) || ev < EV_MIN_VIP) return { ok: false, reason: 'ev_bajo', ev };

  // Antiduplicado
  const dupe = await hayDupeNoMejora({ torneo: item.torneo, seleccion, bestPrice, ev });
  if (dupe) return { ok: false, reason: 'antidupe_sin_mejora' };

  const topBooks = (match.books || []).slice(0,3);

  // Guardar pick VIP
  try {
    await supabase.from('picks_outright').insert({
      torneo: item.torneo,
      mercado: item.mercado,
      seleccion,
      cuota: bestPrice,
      probabilidad: prob,
      ev,
      analisis: String(pick.analisis_vip || 's/d'),
      activo: true,
      timestamp: nowIso()
    });
  } catch (e) {
    warn('[outrights] supabase insert error:', e?.message || e);
  }

  // Enviar VIP
  const msg = mensajeVipOutright({
    torneo: item.torneo,
    mercado: item.mercado,
    seleccion,
    bestPrice,
    probPct,
    ev,
    topBooks,
    analisis_vip: pick.analisis_vip,
    frase: pick.frase_motivacional,
    fechaInicioISO,
    apuestas_extra: pick.apuestas_extra
  });
  const sent = await enviarTelegram(msg, 'vip');
  return { ok: sent, modeloUsado, ev, seleccion, bestPrice };
}

/* ===========================
 *  Telegram
 * =========================== */
async function enviarTelegram(text, tipo = 'vip') {
  const token = TELEGRAM_BOT_TOKEN;
  const chat_id = tipo === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!token || !chat_id) return false;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const ok = res.ok;
    if (!ok) {
      const body = await res.text().catch(()=> '');
      warn('[telegram] bad status', res.status, body);
    }
    return ok;
  } catch (e) {
    warn('[telegram] error', e?.message || e);
    return false;
  }
}

/* ===========================
 *  Fecha de inicio (opcional)
 * =========================== */
// Placeholder best-effort (puedes enriquecer con API-FOOTBALL si deseas)
async function resolverFechaInicioTorneo(torneo) {
  void torneo; // noop
  return null;
}

/* ===========================
 *  Memoria 30d por torneo (opcional)
 * =========================== */
async function obtenerMemoriaLigaResumen(torneo) {
  try {
    const { data } = await supabase.from('functions_status').select('summary').eq('name', 'memoria_outright_'+torneo).maybeSingle();
    return (data && data.summary) ? String(data.summary).slice(0, 600) : null;
  } catch {
    return null;
  }
}

/* ===========================
 *  Handler principal
 * =========================== */
exports.handler = async (event) => {
  const run_id = Math.random().toString(36).slice(2);
  let oai_calls = 0;
  let oai_ok = 0;

  try {
    if (ENABLE_OUTRIGHTS !== 'true') {
      warn('[outrights] módulo desactivado');
      return json(200, { ok: true, disabled: true });
    }
    if (!OPENAI_API_KEY || !ODDS_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) {
      return json(500, { error: 'Config incompleta' });
    }

    // LOCK
    const got = await acquireLock('autopick-outrights', 180);
    if (!got) {
      warn('LOCK activo → salto ciclo (outrights)');
      await endRun(run_id, {
        status: 'skipped',
        summary: { reason: 'lock' }
      });
      return json(200, { ok: true, skipped: 'lock' });
    }

    // Fetch Outrights con breaker
    const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&markets=outrights&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
    const t0 = Date.now();
    const res = await fetch(url, { timeout: 15000 }).catch(e => ({ ok: false, status: 0, _err: e?.message || e }));
    if (!res || !res.ok) {
      const body = res && typeof res.text === 'function' ? await res.text().catch(()=> '') : '';
      warn('[oddsapi] error', res?.status, body);
      await endRun(run_id, {
        status: 'api_error',
        summary: { provider: 'oddsapi', status: res?.status, body: String(body).slice(0, 200) }
      });
      return json(200, { ok: true, api_error: 'oddsapi' });
    }
    const raw = await res.json();
    const mapped = mapOutrightsData(raw);

    if (!Array.isArray(mapped) || mapped.length === 0) {
      await endRun(run_id, {
        status: 'ok',
        summary: { empty: true },
        oai_calls, oai_ok
      });
      return json(200, { ok: true, candidatos: 0, enviados_vip: 0, enviados_free: 0 });
    }

    // Priorizar por liquidez (nº outcomes)
    const MAX_CANDS = 6, MAX_OAI = 6;
    const candidatos = mapped
      .sort((a,b)=> (b.outcomes?.length||0) - (a.outcomes?.length||0))
      .slice(0, Math.min(MAX_CANDS, MAX_OAI));

    let enviados_vip = 0, enviados_free = 0;

    for (const item of candidatos) {
      try {
        // contamos intención de llamada a OAI
        oai_calls++;
        const r = await procesarCandidato(item);
        // si procesarCandidato llegó a hacer llamada con JSON válido, lo consideramos ok
        if (r && r.ok != null) oai_ok++;

        if (r && r.ok) enviados_vip++;
      } catch (e) {
        warn('[loop] candidato error:', e?.message || e);
      }
      await sleep(400);
    }

    // Si no hubo VIPs, enviar FREE informativo con el top candidato
    if (enviados_vip === 0 && ENABLE_OUTRIGHTS_INFO === 'true' && TELEGRAM_CHANNEL_ID) {
      const top = candidatos[0];
      if (top) {
        const fechaInicioISO = await resolverFechaInicioTorneo(top.torneo).catch(()=>null);
        const info = mensajeFreeInformativo({
          torneo: top.torneo,
          fechaInicioISO,
          analisis: 'Sin valor claro en cuotas actuales. Vigila movement y noticias (lesiones, sorteos) para optimizar entrada.'
        });
        const okFree = await enviarTelegram(info, 'free');
        if (okFree) enviados_free++;
      }
    }

    await endRun(run_id, {
      status: 'ok',
      summary: {
        run_ms: Date.now() - t0,
        candidatos: candidatos.length,
        enviados_vip,
        enviados_free
      },
      oai_calls, oai_ok
    });

    return json(200, {
      ok: true,
      candidatos: candidatos.length,
      enviados_vip,
      enviados_free
    });

  } catch (e) {
    const msg = e?.message || e;
    error('[outrights] error general:', msg);
    await endRun(run_id, { status: 'error', error: String(msg), oai_calls, oai_ok });
    return json(500, { error: 'internal' });
  } finally {
    await releaseLock('autopick-outrights');
  }
};
