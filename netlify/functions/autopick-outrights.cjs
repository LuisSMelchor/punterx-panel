// netlify/functions/autopick-outrights.cjs
// PunterX · AUTOPICK OUTRIGHTS (Futures)
// - Descubre torneos con mercado 'outrights/winner' (OddsAPI) con control de liquidez/exclusiones
// - Genera pick VIP con EV (apuesta sugerida + extras si también tienen EV) o, si no hay valor, análisis FREE informativo
// - Guardrails: coherencia prob–cuota ±pp, EV mínimo, antiduplicado por selección
// - Robusto: lock de ciclo, circuit breaker, timeouts y reintentos
// - Mensaje incluye fecha de inicio del torneo (si se puede resolver)

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
// ⬇️ Migración a openai@4
const OpenAI = require('openai');

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
  OUTRIGHTS_EXCLUDE = '*u19*,*u20*,*friendly*,*reserves*,*women*,*amateur*', // patrones a excluir (minúsculas, coma-separado)

  // Guardrails / Umbrales
  OUTRIGHTS_EV_MIN_VIP = '15',             // EV mínimo VIP (%)
  OUTRIGHTS_COHERENCE_MAX_PP = '15',       // |p_modelo - p_implícita| (pp)
  OUTRIGHTS_PROB_MIN = '5',                // % (IA)
  OUTRIGHTS_PROB_MAX = '85',               // % (IA)
  OUTRIGHTS_ANTIDUPE_MIN_IMPROVE = '5',    // % mejora mínima de cuota o EV vs pick activo previo

  // Presupuesto
  MAX_OUTRIGHT_CANDIDATES = '3',           // máx. torneos a analizar por corrida
  MAX_OUTRIGHT_OAI_CALLS = '3',            // máx. llamadas IA por corrida (1 por candidato)

  // IA / OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-5',
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
const ANTIDUPE_MIN_IMPROVE = Number(OUTRIGHTS_ANTIDUPE_MIN_IMPROVE) || 5;

const MAX_CANDS = Math.max(1, Number(MAX_OUTRIGHT_CANDIDATES) || 3);
const MAX_OAI = Math.max(1, Number(MAX_OUTRIGHT_OAI_CALLS) || 3);

// Exclusiones
const EXCLUDES = OUTRIGHTS_EXCLUDE
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Clientes
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// ⬇️ Migración a openai@4
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function fetchWithRetry(url, options = {}, { retries = 1, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && (res.status === 429 || (res.status >= 500 && res.status <= 599))) {
      const ra = Number(res.headers.get('retry-after') || 0);
      const backoff = ra > 0 ? ra * 1000 : 800;
      await sleep(backoff);
      return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally { clearTimeout(t); }
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function matchExcluded(name = '') {
  const s = String(name || '').toLowerCase();
  return EXCLUDES.some(pat => {
    const re = new RegExp(pat.replace(/\*/g, '.*'));
    return re.test(s);
  });
}

/* ===========================
 *  DIAGNÓSTICO (functions_status / function_runs)
 * =========================== */
function makeRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function upsertFunctionStatus({ enabled, schedule, env_ok }) {
  try {
    await supabase.from('functions_status').upsert({
      name: FN_NAME,
      enabled: !!enabled,
      schedule: schedule || null,
      env_ok: !!env_ok,
      updated_at: nowIso(),
    });
  } catch (e) {
    warn(`[diag][${FN_NAME}] upsertFunctionStatus error:`, e?.message || e);
  }
}

async function beginRun(meta = {}) {
  const run_id = makeRunId();
  try {
    await supabase.from('function_runs').insert({
      run_id,
      fn_name: FN_NAME,
      started_at: nowIso(),
      meta: meta || null,
      status: 'running',
    });
  } catch (e) {
    warn(`[diag][${FN_NAME}] beginRun error:`, e?.message || e);
  }
  return run_id;
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
 *  KV Runtime & Locks (Supabase)
 * =========================== */
async function getKV(key) {
  try {
    const { data } = await supabase.from('kv_runtime')
      .select('v, updated_at').eq('k', key).maybeSingle();
    return data ? { v: data.v, updated_at: data.updated_at } : null;
  } catch { return null; }
}
async function setKV(key, val) {
  try {
    await supabase.from('kv_runtime').upsert({
      k: key, v: val, updated_at: nowIso()
    });
  } catch {}
}

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

// Circuit breaker específico para odds outrights
async function withOutrightsBreaker(fn) {
  const now = Date.now();
  const st = await getKV('odds_out_breaker');
  if (st?.v?.until && now < Number(st.v.until)) {
    warn('Odds Outrights breaker ON — saltando consulta');
    return { skipped: true, data: [] };
  }
  try {
    const data = await fn();
    await setKV('odds_out_failures', { n: 0 });
    return { data };
  } catch (e) {
    const cur = (await getKV('odds_out_failures'))?.v?.n || 0;
    const n = cur + 1;
    await setKV('odds_out_failures', { n });
    if (n >= 3) {
      const until = now + 120000; // 2 min
      await setKV('odds_out_breaker', { until });
      warn('Odds Outrights breaker ON (120s)');
    }
    throw e;
  }
}

/* ===========================
 *  Telegram
 * =========================== */
async function enviarTelegram(texto, tipo = 'vip') {
  if (!TELEGRAM_BOT_TOKEN) {
    warn('[outrights] Falta TELEGRAM_BOT_TOKEN');
    return false;
  }
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!chatId) {
    warn('[outrights] Falta chat ID para tipo', tipo);
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX = 4096;

  const partes = [];
  let tx = String(texto || '');
  while (tx.length > MAX) { partes.push(tx.slice(0, MAX)); tx = tx.slice(MAX); }
  partes.push(tx);

  for (const chunk of partes) {
    let res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' })
    }, { retries: 1, timeoutMs: 15000 });

    if (res && res.status === 429) {
      const j = await res.json().catch(()=> ({}));
      const retryAfter = Number(j?.parameters?.retry_after || 0);
      if (retryAfter > 0 && retryAfter <= 10) {
        warn('[outrights] Telegram 429, esperando', retryAfter, 's');
        await sleep(retryAfter * 1000);
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' })
        });
      }
    }
    if (!res?.ok) {
      const t = await safeText(res);
      error('[outrights] Telegram no ok:', res?.status, t?.slice?.(0,300));
      return false;
    }
  }
  return true;
}

/* ===========================
 *  IA helpers (gpt-5 compatible)
 * =========================== */
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
  const t = String(text).replace(/```json|```/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function ensureOutrightShape(p) {
  if (!p || typeof p !== 'object') p = {};
  // Incluimos 'probabilidad' para EV; extras opcionales (array de strings)
  return {
    analisis_vip: p.analisis_vip ?? 's/d',
    apuesta: p.apuesta ?? '',               // "Ganador: Inglaterra"
    apuestas_extra: p.apuestas_extra ?? '', // texto simple o bullets
    frase_motivacional: p.frase_motivacional ?? 's/d',
    probabilidad: typeof p.probabilidad === 'number' ? p.probabilidad : null
  };
}

/* ===========================
 *  Odds / EV helpers
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
function evPct(probDecimal, bestPrice) {
  if (!Number.isFinite(probDecimal) || !Number.isFinite(bestPrice)) return null;
  return +(((probDecimal * bestPrice) - 1) * 100).toFixed(2);
}
function withinPP(a, b, max) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= max;
}

/* ===========================
 *  Fechas: inicio de torneo (opcional via API-Football)
 * =========================== */
async function resolverFechaInicioTorneo(nombreTorneo) {
  try {
    if (!API_FOOTBALL_KEY || !nombreTorneo) return null;
    const q = encodeURIComponent(nombreTorneo);
    // Buscamos liga por nombre y tomamos la temporada activa más cercana
    const url = `https://v3.football.api-sports.io/leagues?search=${q}`;
    const res = await fetchWithRetry(url, {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    }, { retries: 1, timeoutMs: 12000 });
    if (!res?.ok) return null;
    const data = await res.json().catch(()=>null);
    const leagues = data?.response || [];
    if (!Array.isArray(leagues) || !leagues.length) return null;

    // Tomamos la primera con seasons y buscamos start más cercano al futuro.
    let best = null;
    const now = Date.now();
    for (const lg of leagues) {
      const seasons = lg?.seasons || [];
      for (const s of seasons) {
        const start = s?.start ? new Date(s.start).getTime() : null;
        if (start && start >= now) {
          if (!best || start < best) best = start;
        }
      }
    }
    if (!best) return null;
    return new Date(best).toISOString();
  } catch { return null; }
}

/* ===========================
 *  OddsAPI Outrights
 * =========================== */
// NOTA: el endpoint puede variar según plan; aquí usamos v4 con markets=outrights, y aceptamos market keys similares.
async function fetchOutrightsRaw() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,uk&markets=outrights,winner&oddsFormat=decimal&dateFormat=iso&apiKey=${ODDS_API_KEY}`;
  const res = await fetchWithRetry(url, {}, { retries: 1, timeoutMs: 15000 });
  if (!res || !res.ok) {
    const t = await safeText(res);
    throw new Error(`OddsAPI Outrights HTTP ${res?.status}: ${t?.slice?.(0,200)}`);
  }
  return res.json();
}

function mapearOutrights(data) {
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
          if (!o?.name || !o?.price) continue;
          const name = String(o.name).trim();
          const price = Number(o.price);
          if (!Number.isFinite(price) || price <= 1) continue;
          if (!allOutcomes[name]) {
            allOutcomes[name] = { name, bestPrice: price, books: [bk?.title || ''] };
          } else {
            if (price > allOutcomes[name].bestPrice) allOutcomes[name].bestPrice = price;
            const bt = bk?.title || '';
            if (bt && !allOutcomes[name].books.includes(bt)) allOutcomes[name].books.push(bt);
          }
        }
      }
    }

    const arr = Object.values(allOutcomes).sort((a,b)=> b.bestPrice - a.bestPrice);
    if (arr.length < MIN_OUTCOMES) continue;

    out.push({
      torneo,
      mercado: 'Ganador del torneo',
      outcomes: arr.slice(0, 50) // suficiente para matching
    });
  }
  return out;
}

/* ===========================
 *  IA Prompt (apuesta sugerida + extras)
 * =========================== */
function construirPromptOutright({ torneo, mercado, topOutcomes, memoriaLiga30d, fechaInicioISO }) {
  const lines = [];
  lines.push(`Eres un analista de apuestas experto. Devuelve SOLO un JSON con esta forma EXACTA:`);
  lines.push(`{`);
  lines.push(`  "analisis_vip": "",`);
  lines.push(`  "apuesta": "",                // ejemplo: "Ganador: Inglaterra"`);
  lines.push(`  "apuestas_extra": "",         // bullets o texto breve opcional`);
  lines.push(`  "frase_motivacional": "",`);
  lines.push(`  "probabilidad": 0.0           // decimal (0.05 a 0.85)`);
  lines.push(`}`);
  lines.push(`Reglas:`);
  lines.push(`- "probabilidad" es decimal (no %), rango 0.05–0.85.`);
  lines.push(`- "apuesta" debe referirse a una selección EXACTA de las listadas.`);
  lines.push(`- Sé claro y táctico en "analisis_vip" (3–5 líneas).`);
  lines.push(`- En "apuestas_extra" sugiere 0–3 ideas breves SOLO si también tienen valor potencial.`);
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
  return lines.join('\n');
}

/* ===========================
 *  IA Call
 * =========================== */
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
 *  Antiduplicado
 * =========================== */
async function hayDupeNoMejora({ torneo, seleccion, bestPrice, ev }) {
  try {
    const { data } = await supabase
      .from('picks_outright')
      .select('seleccion, cuota, ev, activo, timestamp')
      .eq('torneo', torneo)
      .eq('seleccion', seleccion)
      .order('timestamp', { ascending: false })
      .limit(1);
    if (!data || !data.length) return false;
    const prev = data[0];
    if (prev && prev.activo) {
      const improvePrice = prev.cuota ? ((bestPrice - prev.cuota) / prev.cuota) * 100 : 0;
      const improveEV = (Number.isFinite(ev) && Number.isFinite(prev.ev)) ? (ev - prev.ev) : 0;
      return (improvePrice < ANTIDUPE_MIN_IMPROVE) && (improveEV < ANTIDUPE_MIN_IMPROVE);
    }
    return false;
  } catch { return false; }
}

/* ===========================
 *  FREE informativo (si no hay valor)
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
function mensajeVipOutright({ torneo, mercado, seleccion, bestPrice, probPct, ev, topBooks, analisis_vip, frase, fechaInicioISO, apuestas_extra }) {
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
    `📈 Prob. estimada (IA): ${probPct}%`,
    `💹 EV: ${ev}%`,
    topBooks?.length ? `🏦 Top 3 bookies: ${topBooks.slice(0,3).join(' · ')}` : '',
    `🧠 ${analisis_vip}`,
    extras,
    `💬 ${frase}`,
    '⚠️ Apuestas a largo plazo (alta varianza). Juego responsable.'
  ].filter(Boolean).join('\n');
}

/* ===========================
 *  Flujo por candidato
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

  // Fallback si falla
  if (!pick) {
    warn('♻️ Fallback de modelo →', OPENAI_MODEL_FALLBACK);
    modeloUsado = OPENAI_MODEL_FALLBACK;
    pick = await pedirOutrightConModelo(OPENAI_MODEL_FALLBACK, prompt).catch(e => {
      warn('[outrights] OAI fallback err:', e?.message || e);
      return null;
    });
  }
  if (!pick) return { ok: false, reason: 'json_vacio' };

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
  const ev = evPct(prob, bestPrice);                    // EV en %

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
 *  Memoria 30d (resumen liga/torneo)
 * =========================== */
async function obtenerMemoriaLigaResumen(ligaONombre, windowDias = 30) {
  try {
    if (!ligaONombre) return null;
    const { data } = await supabase
      .from('memoria_resumen')
      .select('samples, hit_rate, ev_prom, mercados_top')
      .eq('liga', ligaONombre)
      .eq('window_dias', windowDias)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const mkts = Array.isArray(data.mercados_top) ? data.mercados_top.slice(0,3).join(' / ') : '';
    return `Últ. ${windowDias}d: hit ${data.hit_rate}% • EV prom ${data.ev_prom}% • mercados top: ${mkts || 's/d'}`;
  } catch { return null; }
}

/* ===========================
 *  Handler
 * =========================== */
exports.handler = async () => {
  // --- Estado/diagnóstico de función ---
  const env_ok = !!(SUPABASE_URL && SUPABASE_KEY && OPENAI_API_KEY);
  await upsertFunctionStatus({
    enabled: ENABLE_OUTRIGHTS === 'true',
    schedule: process.env.NETLIFY_SCHEDULE || null,
    env_ok
  });
  const run_meta = {
    schedule: process.env.NETLIFY_SCHEDULE || null,
    flags: { ENABLE_OUTRIGHTS, ENABLE_OUTRIGHTS_INFO }
  };
  const run_id = await beginRun(run_meta);

  // --- Métricas de corrida ---
  let oai_calls = 0;
  let oai_ok = 0;
  let candidatos_len = 0;
  let enviados_vip = 0;
  let enviados_free = 0;

  try {
    if (ENABLE_OUTRIGHTS !== 'true') {
      await endRun(run_id, {
        status: 'skipped',
        summary: { reason: 'disabled' }
      });
      return json(200, { ok: true, skipped: 'disabled' });
    }
    if (!SUPABASE_URL || !SUPABASE_KEY || !ODDS_API_KEY || !OPENAI_API_KEY) {
      await endRun(run_id, {
        status: 'error',
        error: 'Config incompleta'
      });
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
    let raw;
    try {
      const r = await withOutrightsBreaker(fetchOutrightsRaw);
      if (r.skipped) {
        await endRun(run_id, {
          status: 'skipped',
          summary: { reason: 'breaker' }
        });
        return json(200, { ok: true, skipped: 'breaker' });
      }
      raw = r.data;
    } catch (e) {
      const msg = e?.message || e;
      error('[outrights] Error OddsAPI:', msg);
      await endRun(run_id, {
        status: 'error',
        error: `OddsAPI: ${msg}`
      });
      return json(200, { ok: true, skipped: 'oddsapi_error' });
    }

    const mapped = mapearOutrights(raw);
    candidatos_len = mapped.length;
    if (!candidatos_len) {
      log('[outrights] Sin torneos/outcomes mapeables');
      await endRun(run_id, {
        status: 'ok',
        summary: { candidatos: 0, enviados_vip: 0, enviados_free: 0 },
        oai_calls, oai_ok
      });
      return json(200, { ok: true, candidatos: 0, enviados_vip: 0, enviados_free: 0 });
    }

    // Priorizar por liquidez (nº outcomes)
    const candidatos = mapped
      .sort((a,b)=> (b.outcomes?.length||0) - (a.outcomes?.length||0))
      .slice(0, Math.min(MAX_CANDS, MAX_OAI));

    for (const item of candidatos) {
      try {
        // contamos intención de llamada a OAI
        oai_calls++;
        const r = await procesarCandidato(item);
        // si procesarCandidato llegó a hacer llamada con JSON válido, lo consideramos ok
        if (r && r.ok) { enviados_vip++; oai_ok++; }
        else { log('[outrights] descartado:', item.torneo, r?.reason || 'unknown'); }
        await sleep(200);
      } catch (e) {
        warn('[outrights] error candidato:', item.torneo, e?.message || e);
      }
    }

    // Si no enviamos VIP y está permitido, mandamos FREE informativo del torneo top con breve análisis
    if (enviados_vip === 0 && ENABLE_OUTRIGHTS_INFO === 'true' && TELEGRAM_CHANNEL_ID) {
      const top = candidatos[0];
      if (top) {
        const fechaInicioISO = await resolverFechaInicioTorneo(top.torneo).catch(()=>null);
        const info = mensajeFreeInformativo({
          torneo: top.torneo,
          fechaInicioISO,
          analisis: 'Sin valor claro en cuotas actuales. Vigilamos line movement y noticias (lesiones, sorteos) para optimizar entrada.'
        });
        const okFree = await enviarTelegram(info, 'free');
        if (okFree) enviados_free++;
      }
    }

    await endRun(run_id, {
      status: 'ok',
      summary: { candidatos: candidatos_len, enviados_vip, enviados_free },
      oai_calls, oai_ok
    });

    return json(200, {
      ok: true,
      candidatos: candidatos_len,
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
