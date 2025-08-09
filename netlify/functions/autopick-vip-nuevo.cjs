// netlify/functions/autopick-vip-nuevo.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–60 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrails anti-inconsistencias, prefiltro que prioriza sin descartar,
// Telegram con rate-limit handling, Supabase idempotente.

// =============== IMPORTS ===============
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

// =============== ENV & ASSERT ===============
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK,
  WINDOW_MIN: ENV_WIN_MIN,
  WINDOW_MAX: ENV_WIN_MAX,
  WINDOW_FALLBACK_MIN,
  WINDOW_FALLBACK_MAX,
  PREFILTER_MAX_PRICE,
  PREFILTER_RECENCY_MIN,
  REQUEST_TIMEOUT_MS: ENV_TIMEOUT,
  MAX_OAI_CALLS_PER_CYCLE: ENV_OAI_CAP,
  CYCLE_SOFT_BUDGET_MS: ENV_SOFT_BUDGET
} = process.env;

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID','ODDS_API_KEY','API_FOOTBALL_KEY'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error('Faltan variables de entorno: ' + missing.join(', '));
  }
}

// =============== CLIENTES ===============
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
const MODEL = (process.env.OPENAI_MODEL || OPENAI_MODEL || 'gpt-4o-mini');
const MODEL_FALLBACK = (process.env.OPENAI_MODEL_FALLBACK || 'gpt-4o');

// =============== CONFIG (ENV-overridable) ===============
const WINDOW_MIN       = Number(process.env.WINDOW_MIN || 45);
const WINDOW_MAX       = Number(process.env.WINDOW_MAX || 55);
const WINDOW_FB_MIN    = Number(process.env.WINDOW_FALLBACK_MIN || 35);
const WINDOW_FB_MAX    = Number(process.env.WINDOW_FALLBACK_MAX || 70);

const PREFILTER_MAX_PRICE_VAL  = Number(process.env.PREFILTER_MAX_PRICE || 6.00);
const PREFILTER_RECENCY_MIN_VAL= Number(process.env.PREFILTER_RECENCY_MIN || 15);   // minutos

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);
const RETRIES = 2;
const BACKOFF_MS = 600;

const MAX_OAI_CALLS_PER_CYCLE = Number(process.env.MAX_OAI_CALLS_PER_CYCLE || 0); // 0 = sin tope
const CYCLE_SOFT_BUDGET_MS    = Number(process.env.CYCLE_SOFT_BUDGET_MS || 70000);

// Log de configuración de ventanas
console.log(`⚙️ Config ventana principal: ${WINDOW_MIN}–${WINDOW_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);

// Función para log de filtrado
function logFiltradoPartidos(partidos, etiqueta) {
    const enVentana = partidos.filter(p => p.enVentanaPrincipal).length;
    console.log(`📊 Filtrado (${etiqueta}): Principal=${enVentana} | Fallback=${partidos.filter(p => p.enVentanaFallback && !p.enVentanaPrincipal).length} | Total recibidos=${partidos.length}`);
}

// =============== TIME/FORMAT UTILS ===============
function minutesUntil(tsMs) {
  const now = Date.now();
  return (tsMs - now) / 60000;
}
function formatMinAprox(m) {
  if (m <= 1) return 'Comienza en 1 minuto aprox';
  return `Comienza en ${m} minutos aprox`;
}
function median(arr) {
  if (!arr?.length) return null;
  const a = [...arr].sort((x,y)=>x-y);
  const mid = Math.floor(a.length/2);
  return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
}

// =============== ESTADO GLOBAL ===============
const resumen = {
  recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0,
  descartados_ev: 0, enviados_vip: 0, enviados_free: 0,
  intentos_vip: 0, intentos_free: 0, guardados_ok: 0, guardados_fail: 0,
  oai_calls: 0
};

// =============== HANDLER ===============
exports.handler = async function () {
  try {
    assertEnv();

    const startTs = Date.now();
    const partidosBase = await obtenerPartidosDesdeOddsAPI();
    logFiltradoPartidos(partidosBase, 'OddsAPI');

    const grupos = chunkArray(partidosBase, 6);
    for (const grupo of grupos) {
      if (Date.now() - startTs > CYCLE_SOFT_BUDGET_MS) {
        console.warn('⏳ Soft budget agotado — cortamos ciclo');
        break;
      }
      if (MAX_OAI_CALLS_PER_CYCLE > 0 && resumen.oai_calls >= MAX_OAI_CALLS_PER_CYCLE) {
        console.warn('🎛️ OAI_CAP alcanzado — dejamos el resto para el próximo ciclo');
        break;
      }

      const tasks = grupo.map(async p => {
        if (MAX_OAI_CALLS_PER_CYCLE > 0 && resumen.oai_calls >= MAX_OAI_CALLS_PER_CYCLE) return;
        const prev = resumen.procesados;
        await procesarPartido(p);
        // oai_calls se contabiliza al momento de llamar a OpenAI
      });

      await Promise.allSettled(tasks);
    }

    console.log('Resumen ciclo:', JSON.stringify(resumen));
    return ok({ mensaje: 'Ciclo completado', resumen });
  } catch (e) {
    console.error('❌ Error general en autopick:', e?.message || e);
    return err('Error interno');
  }
};

function ok(body)  { return { statusCode: 200, body: JSON.stringify(body) }; }
function err(msg)  { return { statusCode: 500, body: JSON.stringify({ error: msg }) }; }

// =============== ODDs API =================
async function obtenerPartidosDesdeOddsAPI() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,uk&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso&apiKey=${ODDS_API_KEY}`;

  let res;
  try {
    res = await fetchWithRetry(url, {}, { retries: 1 });
  } catch (e) {
    console.error('❌ Error red OddsAPI:', e?.message || e);
    return [];
  }
  if (!res || !res.ok) {
    console.error('❌ OddsAPI no ok:', res?.status, await safeText(res));
    return [];
  }

  let data;
  try { data = await res.json(); } catch { console.error('❌ JSON OddsAPI inválido'); return []; }
  if (!Array.isArray(data)) return [];

  resumen.recibidos = data.length;

  const ahora = Date.now();
  const mapeados = data.map(e => normalizeOddsEvent(e, ahora)).filter(Boolean);

  // Depuración de minutos
  for (const e of mapeados.slice(0,3)) {
    console.log('DBG commence_time=', new Date(e.timestamp).toISOString(), 'mins=', Math.round(e.minutosFaltantes));
  }

  const enVentana = mapeados.filter(p => p.enVentanaPrincipal);
  const fallback   = mapeados.filter(p => !p.enVentanaPrincipal && p.enVentanaFallback);

  console.log(`OddsAPI: recibidos=${mapeados.length}, en_ventana=${enVentana.length} (${WINDOW_MIN}–${WINDOW_MAX}m)`);

  return enVentana.concat(fallback);
}

function normalizeOddsEvent(e, ahoraTs) {
  const commenceISO = e?.commence_time || e?.commenceTime || e?.start_time;
  if (!commenceISO) return null;

  const ts = Date.parse(commenceISO);
  if (!Number.isFinite(ts)) return null;

  const mins = (ts - ahoraTs) / 60000;

  const principal = (mins >= WINDOW_MIN && mins <= WINDOW_MAX);
  const fallback  = (mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX);

  return {
    id: `${e?.id || e?.event_id || e?.commence_time}-${e?.home_team}-${e?.away_team}`,
    sport_title: e?.sport_title || 'Soccer',
    home: e?.home_team || e?.homeTeam || '',
    away: e?.away_team || e?.awayTeam || '',
    timestamp: ts,
    minutosFaltantes: mins,
    enVentanaPrincipal: principal,
    enVentanaFallback: fallback,
    // precios mínimos por mercado (h2h/totals/spreads)
    marketsBest: extraerMejoresCuotas(e),
    marketsOffers: extraerOfertasDetalladas(e),
    mejorCuota: bestOverall(e)
  };
}

function bestOverall(e) {
  const allPrices = [];
  if (e?.bookmakers) {
    for (const b of e.bookmakers) {
      for (const m of b.markets || []) {
        for (const o of m.outcomes || []) {
          const price = Number(o.price);
          if (Number.isFinite(price)) allPrices.push(price);
        }
      }
    }
  }
  const mx = allPrices.length ? Math.max(...allPrices) : null;
  return mx ? { valor: mx } : null;
}

function extraerMejoresCuotas(e) {
  const out = { h2h: null, totals: null, spreads: null };
  const books = e?.bookmakers || [];
  const byMarket = {};
  for (const b of books) {
    for (const m of b.markets || []) {
      if (!byMarket[m.key]) byMarket[m.key] = [];
      const prices = (m.outcomes || []).map(o => Number(o.price)).filter(Number.isFinite);
      if (prices.length) byMarket[m.key].push(Math.max(...prices));
    }
  }
  if (byMarket.h2h?.length) out.h2h = { best: Math.max(...byMarket.h2h) };
  if (byMarket.totals?.length) out.totals = { best: Math.max(...byMarket.totals) };
  if (byMarket.spreads?.length) out.spreads = { best: Math.max(...byMarket.spreads) };
  return out;
}
function extraerOfertasDetalladas(e) {
  // Devuelve listas detalladas por mercado para top3 luego
  const offers = { h2h: [], totals_over: [], totals_under: [], spreads: [] };
  for (const b of (e?.bookmakers || [])) {
    const nombre = b?.title || b?.key || 'book';
    for (const m of (b?.markets || [])) {
      if (m.key === 'h2h') {
        for (const o of (m.outcomes || [])) {
          offers.h2h.push({ book: nombre, label: o.name, valor: Number(o.price) });
        }
      }
      if (m.key === 'totals') {
        for (const o of (m.outcomes || [])) {
          if (o.name?.toLowerCase().includes('over')) offers.totals_over.push({ book: nombre, label: o.name, valor: Number(o.price), point: o.point ?? null });
          if (o.name?.toLowerCase().includes('under')) offers.totals_under.push({ book: nombre, label: o.name, valor: Number(o.price), point: o.point ?? null });
        }
      }
      if (m.key === 'spreads') {
        for (const o of (m.outcomes || [])) {
          offers.spreads.push({ book: nombre, label: o.name, valor: Number(o.price), point: o.point ?? null });
        }
      }
    }
  }
  // Ordenamos descendente para top3
  for (const k of Object.keys(offers)) offers[k].sort((a,b)=> (b.valor||0)-(a.valor||0));
  return offers;
}

// =============== HTTP utils con BACKOFF EXponencial (429/5xx + retry-after) ===============
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBackoff(url, options = {}, cfg = {}) {
  const attempts = cfg.attempts ?? (RETRIES + 1);
  const baseMs = cfg.baseMs ?? BACKOFF_MS;
  const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const controllerFactory = () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return { controller, timer };
  };

  const parseRetryAfter = (headers) => {
    try {
      const ra = headers?.get?.('retry-after');
      if (!ra) return null;
      const num = Number(ra);
      if (!Number.isNaN(num)) return Math.min(num * 1000, 30000);
      const dt = Date.parse(ra);
      if (!Number.isNaN(dt)) return Math.min(Math.max(dt - Date.now(), 0), 30000);
    } catch {}
    return null;
  };

  const expDelay = (i) => Math.min((2 ** i) * baseMs + Math.random()*200, 10000);

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const { controller, timer } = controllerFactory();
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (res?.ok) return res;

      const status = res?.status || 0;
      if (status === 429 || (status >= 500 && status <= 599)) {
        const retryAfter = parseRetryAfter(res?.headers);
        const delay = retryAfter ?? expDelay(i);
        console.warn(`[BACKOFF] ${url} status=${status} intento=${i+1}/${attempts} espera=${delay}ms`);
        await sleep(delay);
        continue;
      } else {
        // 4xx duro (p.ej. 400/401/403/404): devolvemos tal cual para que la capa llamante decida
        return res;
      }
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      const delay = expDelay(i);
      console.warn(`[BACKOFF] red ${url} intento=${i+1}/${attempts} espera=${delay}ms msg=${e?.message}`);
      await sleep(delay);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('fetchWithBackoff agotado');
}

async function fetchWithRetry(url, options = {}, cfg = {}) {
  const attempts = (cfg.retries != null) ? (cfg.retries + 1) : (RETRIES + 1);
  const baseMs = cfg.backoff ?? BACKOFF_MS;
  const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;
  return await fetchWithBackoff(url, options, { attempts, baseMs, timeoutMs });
}

async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// =============== Football API (enriquecimiento) ===============
async function enriquecerPartidoConAPIFootball(partido) {
  const q = `${partido.home} ${partido.away}`;
  const url = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(q)}`;

  let res;
  try {
    res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
  } catch (e) {
    console.error(`[evt:${partido.id}] Error red Football:`, e?.message || e);
    return null;
  }
  if (!res || !res.ok) {
    console.error(`[evt:${partido.id}] Football no ok:`, res?.status, await safeText(res));
    return null;
  }
  const data = await safeJson(res);
  const resp = data?.response || [];
  if (!Array.isArray(resp) || !resp.length) return null;

  // Tomamos el primer fixture que más se parezca
  const fx = resp[0];
  const leagueName = fx?.league?.name || '';
  const country    = fx?.league?.country || '';
  const liga = `${leagueName}${country ? ' — ' + country : ''}`;

  const arb = fx?.fixtures?.referee || fx?.fixture?.referee || null;
  const stadium = fx?.fixture?.venue?.name || null;

  return {
    liga,
    arbitro: arb,
    estadio: stadium
  };
}

// =============== Memoria IA (Supabase) ===============
async function obtenerMemoriaSimilar(partido) {
  try {
    const desde = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const liga = (partido?.liga || '').toLowerCase();
    const home = (partido?.home || '').toLowerCase();
    const away = (partido?.away || '').toLowerCase();

    let q = supabase
      .from('picks_historicos')
      .select('liga,equipos,ev,probabilidad,nivel,analisis,timestamp')
      .gte('timestamp', desde)
      .order('timestamp', { ascending: false })
      .limit(12);

    if (liga) q = q.ilike('liga', `%${liga}%`);
    if (home) q = q.ilike('equipos', `%${home}%`);
    if (away) q = q.ilike('equipos', `%${away}%`);

    const { data, error } = await q;
    if (error) { console.error('Supabase memoria error:', error.message); return []; }
    const rows = Array.isArray(data) ? data : [];
    return rows;
  } catch (e) {
    console.warn('MEMORIA similar error:', e?.message || e);
    return [];
  }
}

// =============== PROMPT & OpenAI ===============
function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta);
}

// =============== PROMPT ===============
function construirPrompt(partido, info, memoria) {
  const datosClave = {
    liga: partido?.liga || '(por confirmar)',
    equipos: `${partido.home} vs ${partido.away}`,
    hora_relativa: formatMinAprox(Math.max(0, Math.round(partido.minutosFaltantes))),
    cuotas_disponibles: Object.keys(partido?.marketsBest || {}).filter(k => partido?.marketsBest?.[k]),
    mejor_cuota: partido?.mejorCuota?.valor || null
  };

  return `
Eres un analista deportivo profesional. Devuelve SOLO JSON válido con claves:
{
  "analisis_gratuito": "...",
  "analisis_vip": "...",
  "apuesta": "...",
  "apuestas_extra": "...",
  "frase_motivacional": "..."
}

Datos:
- Liga/país: ${datosClave.liga}
- Equipos: ${datosClave.equipos}
- ${datosClave.hora_relativa}
- Alineaciones: ${info?.alineaciones || 's/d'}
- Árbitro: ${info?.arbitro || 's/d'}
- Clima: ${info?.clima || 's/d'}
- Historial (5): ${info?.historial || 's/d'}
- Forma reciente: ${info?.forma || 's/d'}
- xG: ${info?.xg || 's/d'}
- Ausencias/Regresos: ${info?.ausencias || 's/d'}
- Cuotas disponibles: ${datosClave.cuotas_disponibles.join(', ') || 's/d'}
- Mejor cuota detectada: ${datosClave.mejor_cuota || 's/d'}

Restricciones:
- No inventes si no hay datos. Si faltan, conserva prudencia.
- "apuesta" debe ser clara y mapeable a mercados h2h/totals/spreads.
- Estilo táctico, directo, profesional.
`.trim();
}

// === Helper: payload OpenAI compatible (gpt-5 / 4o / 4.1 / o3 vs legacy) ===
function buildOpenAIPayload(model, prompt, maxOut = 450) {
  const base = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  };
  // Modelos nuevos exigen max_completion_tokens
  if (/gpt-5|gpt-4\.1|4o|o3|mini/i.test(String(model))) {
    base.max_completion_tokens = maxOut;
  } else {
    base.max_tokens = maxOut;
  }
  return base;
}

async function pedirPickConModelo(modelo, prompt) {
  resumen.oai_calls++;
 const completion = await openai.createChatCompletion({
   model: modelo,
   response_format: { type: 'json_object' },
   max_tokens: 450,
   temperature: 0.2,
   messages: [{ role: 'user', content: prompt }],
 });
 const completion = await openai.createChatCompletion(
   buildOpenAIPayload(modelo, prompt, 450)
 );
  const respuesta = completion?.data?.choices?.[0]?.message?.content;
  if (!respuesta || typeof respuesta !== 'string') return null;
  try {
    return JSON.parse(respuesta);
  } catch {
    console.error('JSON inválido de GPT (primeros 300):', respuesta.slice(0,300));
    return null;
  }
}

async function pedirPickConRetry(modelo, prompt) {
  // backoff suave en 2 intentos totales
  for (let i = 0; i < 2; i++) {
    try {
      const r = await pedirPickConModelo(modelo, prompt);
      if (r) return r;
    } catch (e) {
      console.warn('OpenAI fallo intento', i+1, (e?.response?.data?.error?.message || e?.message || String(e)));
    }
    await sleep(500 + Math.floor(Math.random()*500)); // 0.5–1.0s
  }
  return null;
}

async function obtenerPickConFallback(prompt) {
  let modeloUsado = MODEL;
  let pick = await pedirPickConRetry(MODEL, prompt);
  if (pick && pickCompleto(pick)) return { modeloUsado, pick };

  try {
    console.log('♻️ Fallback de modelo →', MODEL_FALLBACK);
    modeloUsado = MODEL_FALLBACK;
    pick = await pedirPickConRetry(MODEL_FALLBACK, prompt);
    if (pick && pickCompleto(pick)) return { modeloUsado, pick };
  } catch {}
  return null; // NO inventar
}

// =============== EV/PROB & CHEQUEOS ===============
function estimarlaProbabilidadPct(pick) {
  if (pick && typeof pick.probabilidad !== 'undefined') {
    const v = Number(pick.probabilidad);
    if (!Number.isNaN(v)) {
      const pct = (v > 0 && v < 1) ? (v * 100) : v; // 0.62 o 62
      return Math.max(5, Math.min(85, Math.round(pct)));
    }
  }
  return null; // NO inventar
}
function impliedProbPct(cuota) {
  const c = Number(cuota);
  if (!Number.isFinite(c) || c <= 1.0) return null;
  return +((100 / c).toFixed(2));
}
function calcularEV(probPct, cuota) {
  const p = Number(probPct) / 100;
  const c = Number(cuota);
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;
  return Math.round((p * c - 1) * 100);
}
function clasificarPickPorEV(ev) {
  if (ev >= 40) return 'Ultra Elite';
  if (ev >= 30) return 'Élite Mundial';
  if (ev >= 20) return 'Avanzado';
  if (ev >= 15) return 'Competitivo';
  return 'Informativo';
}

function inferMarketFromApuesta(apuestaText) {
  const t = String(apuestaText || '').toLowerCase();
  if (t.includes('más de') || t.includes('over')) return { market: 'totals', side: 'over' };
  if (t.includes('menos de') || t.includes('under')) return { market: 'totals', side: 'under' };
  if (t.includes('hándicap') || t.includes('handicap') || t.includes('spread')) return { market: 'spreads', side: null };
  return { market: 'h2h', side: null };
}

function top3ForSelectedMarket(partido, apuestaText) {
  const info = inferMarketFromApuesta(apuestaText);
  let arr = [];
  const offers = partido?.marketsOffers || {};
  if (info.market === 'totals') {
    arr = info.side === 'over' ? (offers.totals_over || []) : (offers.totals_under || []);
  } else if (info.market === 'spreads') {
    arr = offers.spreads || [];
  } else {
    arr = offers.h2h || [];
  }
  const top3 = (arr || []).slice(0, 3);
  return top3;
}

function seleccionarCuotaSegunApuesta(partido, apuestaText) {
  const info = inferMarketFromApuesta(apuestaText);
  const offers = partido?.marketsOffers || {};
  if (info.market === 'totals') {
    const arr = info.side === 'over' ? (offers.totals_over || []) : (offers.totals_under || []);
    return arr[0] || null;
  }
  if (info.market === 'spreads') {
    return (offers.spreads || [])[0] || null;
  }
  return (offers.h2h || [])[0] || null;
}

function apuestaCoincideConOutcome(apuestaTxt, outcomeTxt, home, away) {
  const a = String(apuestaTxt||'').toLowerCase();
  const o = String(outcomeTxt||'').toLowerCase();
  const h = String(home||'').toLowerCase();
  const aw = String(away||'').toLowerCase();

  if (a.includes('local') && o.includes(h)) return true;
  if (a.includes('visitante') && o.includes(aw)) return true;
  if (a.includes('empate') && o.includes('draw')) return true;
  if (a.includes('más de') || a.includes('over')) return o.includes('over');
  if (a.includes('menos de') || a.includes('under')) return o.includes('under');
  if (a.includes('hándicap') || a.includes('handicap') || a.includes('spread')) return o.includes('handicap') || o.includes('spread');

  // fallback flexible
  return true;
}

// =============== Telegram ===============
async function enviarMensajeTelegram(texto, tipo) {
  const chatId = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX_TELEGRAM = 4096;

  const sendOnce = async (payload) => {
    let res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, { retries: 0, timeoutMs: 15000 });

    if (res && res.status === 429) {
      const body = await safeJson(res);
      const retryAfter = Number(body?.parameters?.retry_after || 0);
      if (retryAfter > 0 && retryAfter <= 10) {
        console.warn('Telegram 429 — esperando', retryAfter, 's');
        await sleep(retryAfter * 1000);
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    }
    if (!res?.ok) {
      const body = await safeText(res);
      console.error('Telegram no ok:', res?.status, body?.slice?.(0,300));
      return false;
    }
    return true;
  };

  // Troceo si excede 4096
  const partes = [];
  let txt = String(texto||'');
  while (txt.length > MAX_TELEGRAM) {
    partes.push(txt.slice(0, MAX_TELEGRAM));
    txt = txt.slice(MAX_TELEGRAM);
  }
  partes.push(txt);

  for (const chunk of partes) {
    const ok = await sendOnce({ chat_id: chatId, text: chunk, parse_mode: 'HTML' });
    if (!ok) return false;
  }
  return true;
}

// =============== Guardado en Supabase ===============
async function guardarEnSupabase(P, pick, tipo_pick, nivel, probabilidad, ev) {
  const evento = `${P.liga} | ${P.home} vs ${P.away}`;
  const equipos = `${P.home} vs ${P.away}`;
  const nowIso = new Date().toISOString();

  const payload = {
    evento,
    analisis: pick.analisis_vip || pick.analisis_gratuito || '',
    apuesta: pick.apuesta || '',
    tipo_pick,
    liga: P.liga || '',
    equipos,
    ev,
    probabilidad,
    nivel,
    timestamp: nowIso
  };

  try {
    const { data, error } = await supabase
      .from('picks_historicos')
      .insert(payload)
      .select('id');

    if (error) {
      console.error('Supabase insert error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Supabase insert excepción:', e?.message || e);
    return false;
  }
}

// =============== Procesamiento por partido ===============
async function procesarPartido(partido) {
  const traceId = `[evt:${partido.id}]`;
  try {
    // Enriquecer (API-Football) + memoria (paralelo)
    const [enriqRes, memRes] = await Promise.allSettled([
      enriquecerPartidoConAPIFootball(partido),
      obtenerMemoriaSimilar(partido)
    ]);
    const enr = (enriqRes.status === 'fulfilled') ? enriqRes.value : null;
    const memoria = (memRes.status === 'fulfilled' && Array.isArray(memRes.value)) ? memRes.value : [];

    const P = { ...partido, ...(enr || {}) };
    P.liga = resolverLigaPais({ liga: P.liga, sport_title: partido.sport_title });

    // Guardián: liga obligatoria
    if (!P.liga) { console.warn(traceId, '❌ Liga/país no disponible → descartando'); return; }

    // Prompt
    const prompt = construirPrompt(P, enr, memoria);

    // Llamada a GPT con fallback
    let r;
    try {
      r = await obtenerPickConFallback(prompt);
      if (!r) { console.warn(traceId, 'Pick incompleto tras fallback'); return; }
    } catch (e) {
      console.error(traceId, 'Error GPT:', e?.message || e); return;
    }

    const { modeloUsado, pick } = r;
    console.log(traceId, '🔎 Modelo usado:', modeloUsado);
    if (!pickCompleto(pick)) { console.warn(traceId, 'Pick incompleto tras fallback'); return; }

    // Selección de cuota EXACTA del mercado pedido
    const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
    if (!cuotaSel || !cuotaSel.valor) { console.warn(traceId, '❌ No se encontró cuota del mercado solicitado → descartando'); return; }
    const cuota = Number(cuotaSel.valor);

    // Coherencia apuesta/outcome
    const outcomeTxt = String(cuotaSel.label || P?.marketsBest?.h2h?.label || '');
    if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, P.home, P.away)) {
      console.warn(traceId, '❌ Inconsistencia apuesta/outcome → descartando'); return;
    }

    // Probabilidad (no inventar) + coherencia con implícita
    const probPct = estimarlaProbabilidadPct(pick);
    if (probPct == null) { console.warn(traceId, '❌ Probabilidad ausente → descartando pick'); return; }
    const imp = impliedProbPct(cuota);
    if (imp != null && Math.abs(probPct - imp) > 15) {
      console.warn(traceId, `❌ Inconsistencia prob. modelo (${probPct}%) vs implícita (${imp}%) > 15 pp → descartando`);
      return;
    }

    const ev = calcularEV(probPct, cuota);
    if (ev == null) { console.warn(traceId, 'EV nulo'); return; }
    resumen.procesados++;

    if (ev < 10) { resumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); return; }

    const nivel = clasificarPickPorEV(ev);
    const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';
    if (tipo_pick === 'vip') resumen.intentos_vip++; else resumen.intentos_free++;

    // Mensajes
    const cuotaInfo = { valor: cuota, point: cuotaSel?.point ?? null, top3: cuotaSel?.top3 || [] };
    const mensaje = renderMensaje(P, pick, nivel, probPct, ev, cuotaInfo, tipo_pick);

    // Validación final de datos
    if (!mensaje || !nivel || !probPct || ev == null) {
      console.warn(traceId, 'Datos incompletos → no guardar/enviar.'); return;
    }

    const okSave = await guardarEnSupabase(P, pick, tipo_pick, nivel, probPct, ev);
    if (!okSave) { resumen.guardados_fail++; console.error(traceId, 'Guardar falló/duplicado → no envío'); return; }
    resumen.guardados_ok++;

    const okTG = await enviarMensajeTelegram(mensaje, tipo_pick);
    if (okTG) { if (tipo_pick === 'vip') resumen.enviados_vip++; else resumen.enviados_free++; }
    else { console.error(traceId, 'Fallo Telegram'); }

  } catch (e) {
    console.error(traceId, 'Excepción procesando partido:', e?.message || e);
  }
}

// =============== Formateo de mensajes ===============
function renderMensaje(P, pick, nivel, probPct, ev, cuotaInfo, tipo_pick) {
  const horaTxt = formatMinAprox(Math.max(0, Math.round(P.minutosFaltantes)));
  const ligaTxt = P.liga || '';
  const equiposTxt = `${P.home} vs ${P.away}`;

  const top3 = (cuotaInfo?.top3 || []).map((o,i)=> `${i+1}) ${o.book} ${o.point!=null?`(${o.point}) `:''}${o.valor}`).join('\n');

  if (tipo_pick === 'vip') {
    return [
      `🎯 PICK NIVEL: ${nivel}`,
      `🏆 Liga/País: ${ligaTxt}`,
      `⚔️ Equipos: ${equiposTxt}`,
      `🕒 ${horaTxt}`,
      `📈 Prob. estimada: ${probPct}%`,
      `💹 EV: ${ev}%`,
      `💡 Apuesta sugerida: ${pick.apuesta}`,
      top3 ? `🏦 Top 3 bookies:\n${top3}` : '',
      `🧠 Datos avanzados:\n${pick.analisis_vip}`,
      `🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.`,
      `⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.`
    ].filter(Boolean).join('\n');
  }

  // Canal gratuito
  return [
    `📡 RADAR DE VALOR`,
    `🏆 Liga/País: ${ligaTxt}`,
    `⚔️ Equipos: ${equiposTxt}`,
    `🕒 ${horaTxt}`,
    `🧠 ${pick.analisis_gratuito}`,
    `💬 ${pick.frase_motivacional}`,
    `👉 ¡Únete 15 días gratis al grupo VIP para recibir apuestas sugeridas y análisis completos!`
  ].join('\n');
}

function resolverLigaPais({ liga, sport_title }) {
  if (liga) return liga;
  if (sport_title && sport_title.toLowerCase().includes('soccer')) return 'Fútbol — (por confirmar)';
  return liga || '—';
}
