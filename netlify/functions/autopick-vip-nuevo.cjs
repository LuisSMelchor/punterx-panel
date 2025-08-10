// FILE: netlify/functions/autopick-vip-nuevo.cjs
// SHA256: 6f79835ae23d297d3aa05e444cd910bb79aa29273d86bedc1b47ab4068572660
// LINES: 819
// ---8<---START FILE---8<---
﻿// netlify/functions/autopick-vip-nuevo.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–60 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrails anti-inconsistencias, prefiltro que prioriza sin descartar,
// Telegram con rate-limit handling, Supabase idempotente.

console.log("[TEST][AUTODEPLOY] " + new Date().toISOString());

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
  PUNTERX_SECRET,
  AUTH_CODE
} = process.env;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const OPENAI_MODEL_FALLBACK = process.env.OPENAI_MODEL_FALLBACK || 'gpt-5';
const WINDOW_MAIN_MIN = Number(process.env.WINDOW_MAIN_MIN || 40);
const WINDOW_MAIN_MAX = Number(process.env.WINDOW_MAIN_MAX || 55);
const WINDOW_FB_MIN = Number(process.env.WINDOW_FB_MIN || 35);
const WINDOW_FB_MAX = Number(process.env.WINDOW_FB_MAX || 70);
const PREFILTER_MIN_BOOKIES = Number(process.env.PREFILTER_MIN_BOOKIES || 2);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 6);
const MAX_PER_CYCLE = Number(process.env.MAX_PER_CYCLE || 50);
const SOFT_BUDGET_MS = Number(process.env.SOFT_BUDGET_MS || 70000);
const MAX_OAI_CALLS_PER_CYCLE = Number(process.env.MAX_OAI_CALLS_PER_CYCLE || 40);
const COUNTRY_FLAG = process.env.COUNTRY_FLAG || '🌍';

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY','OPENAI_API_KEY','TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID','ODDS_API_KEY','API_FOOTBALL_KEY'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ ENV faltantes:', missing.join(', '));
    throw new Error('Variables de entorno faltantes');
  }
}

// =============== CLIENTES ===============
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
const MODEL = (process.env.OPENAI_MODEL || OPENAI_MODEL || 'gpt-5-mini');
const MODEL_FALLBACK = (process.env.OPENAI_MODEL_FALLBACK || 'gpt-5');

// =============== CONFIG (ENV-overridable) ===============
const lockKey = 'punterx_lock';
const PICK_TABLE = 'picks_historicos';

// =============== UTILS ===============
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }
function nowISO() { return new Date().toISOString(); }

async function fetchWithRetry(url, init={}, opts={ retries:2, base:500 }) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt >= opts.retries) return res;
        const ra = Number(res.headers.get('retry-after')) || 0;
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

function normalizeStr(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function minutesUntilISO(iso) {
  const t = Date.parse(iso);
  return Math.round((t - Date.now()) / 60000);
}
function formatMinAprox(mins) {
  if (mins == null) return 'Comienza pronto';
  if (mins < 0) return `Ya comenzó (hace ${Math.abs(mins)} min)`;
  return `Comienza en ${mins} min aprox`;
}

function median(numbers) {
  const arr = numbers.filter(n => Number.isFinite(n)).sort((a,b) => a-b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

// =============== NETLIFY HANDLER ===============
exports.handler = async (event, context) => {
  assertEnv();

  const started = Date.now();
  console.log(`⚙️ Config ventana principal: ${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);

  // Lock simple en memoria por invocación isolada (Netlify)
  if (global.__punterx_lock) {
    console.warn('LOCK activo → salto ciclo');
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true }) };
  }
  global.__punterx_lock = true;
  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0
  };

  try {
    // 1) Obtener partidos OddsAPI (prefiltro cuotas activas + ventana)
    const base = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&oddsFormat=decimal&markets=h2h,totals,spreads`;
    const url = `${base}&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithRetry(url, { method:'GET' }, { retries: 1, base: 400 });
    if (!res || !res.ok) {
      console.error('OddsAPI error:', res?.status, await safeText(res));
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason:'oddsapi' }) };
    }
    const eventos = await safeJson(res) || [];
    resumen.recibidos = Array.isArray(eventos) ? eventos.length : 0;

    // 2) Normalizar eventos
    const partidos = (eventos || []).map(normalizeOddsEvent).filter(Boolean);
    const inWindow = partidos.filter(p => {
      const mins = Math.round(p.minutosFaltantes);
      const dbg = `DBG commence_time= ${p.commence_time} mins= ${mins}`;
      console.log(dbg);
      const principal = mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX;
      const fallback = !principal && mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX;
      return principal || fallback;
    });
    resumen.enVentana = inWindow.length;
    console.log(`📊 Filtrado (OddsAPI): Principal=${inWindow.filter(p=>{
      const m = Math.round(p.minutosFaltantes); return m>=WINDOW_MAIN_MIN && m<=WINDOW_MAIN_MAX;}).length} | Fallback=${inWindow.filter(p=>{
      const m = Math.round(p.minutosFaltantes); return !(m>=WINDOW_MAIN_MIN && m<=WINDOW_MAIN_MAX) && m>=WINDOW_FB_MIN && m<=WINDOW_FB_MAX;}).length} | Total recibidos=${inWindow.length}`);
    if (!inWindow.length) {
      console.log('OddsAPI: sin partidos en ventana');
      return { statusCode: 200, body: JSON.stringify({ ok:true, resumen }) };
    }

    // 3) Prefiltro ligero (no descarta, solo prioriza)
    const candidatos = inWindow.sort((a,b) => scorePreliminar(b) - scorePreliminar(a)).slice(0, MAX_PER_CYCLE);
    resumen.candidatos = candidatos.length;
    console.log(`OddsAPI: recibidos=${resumen.recibidos}, en_ventana=${resumen.enVentana} (${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX}m)`);

    // 4) Procesar candidatos con enriquecimiento + OpenAI
    for (const P of candidatos) {
      const traceId = `[evt:${P.id}]`;
      const abortIfOverBudget = () => {
        if (Date.now() - started > SOFT_BUDGET_MS) throw new Error('Soft budget excedido');
      };

      try {
        abortIfOverBudget();

        // A) Enriquecimiento API-FOOTBALL (con backoff mínimo)
        const info = await enriquecerPartidoConAPIFootball(P) || {};

        // B) Memoria relevante (máx 5 en client-side)
        const memoria = await obtenerMemoriaSimilar(P);

        // C) Construir prompt maestro con opciones_apostables reales
        const prompt = construirPrompt(P, info, memoria);

        // D) OpenAI (fallback + 1 reintento en cada modelo)
        let pick, modeloUsado = MODEL;
        try {
          const r = await obtenerPickConFallback(prompt, resumen);
          pick = r.pick; modeloUsado = r.modeloUsado;
          console.log(traceId, '🔎 Modelo usado:', modeloUsado);
          if (esNoPick(pick)) { console.log(traceId, '🛑 no_pick=true →', pick?.motivo_no_pick || 's/d'); return; }
          if (!pickCompleto(pick)) { console.warn(traceId, 'Pick incompleto tras fallback'); return; }
        } catch (e) {
          console.error(traceId, 'Error GPT:', e?.message || e); return;
        }

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
          console.warn(traceId, `❌ Probabilidad inconsistente (model=${probPct}%, implícita=${imp}%) → descartando`);
          return;
        }

        const ev = calcularEV(probPct, cuota);
        if (ev == null) { console.warn(traceId, 'EV nulo'); return; }
        resumen.procesados++;

        if (ev < 10) { resumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); return; }

        // Nivel y destino
        const nivel = clasificarPickPorEV(ev);
        const cuotaInfo = { ...cuotaSel, top3: top3ForSelectedMarket(P, pick.apuesta) };
        const destinoVIP = (ev >= 15);

        // Mensajes
        if (destinoVIP) {
          resumen.intentos_vip++;
          const msg = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo);
          const ok = await enviarVIP(msg);
          if (ok) { resumen.enviados_vip++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, 'VIP'); }
        } else {
          resumen.intentos_free++;
          const msg = construirMensajeFREE(P, pick, probPct, ev, nivel);
          const ok = await enviarFREE(msg);
          if (ok) { resumen.enviados_free++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, 'FREE'); }
        }

      } catch (e) {
        console.error('Procesamiento partido error:', e?.message || e);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ ok:true, resumen }) };

  } catch (e) {
    console.error('Error ciclo principal:', e?.message || e);
    return { statusCode: 200, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
  } finally {
    global.__punterx_lock = false;
    console.log('Resumen ciclo:', JSON.stringify(resumen));
    console.log(`Duration: ${(Date.now()-started).toFixed(2)} ms\tMemory Usage: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
  }
};

// =============== NORMALIZACIÓN ODDSAPI ===============
function normalizeOddsEvent(evento) {
  try {
    const id = evento?.id || evento?.event_id || `${evento?.commence_time}-${evento?.home_team}-${evento?.away_team}`;
    const commence_time = evento?.commence_time;
    const mins = minutesUntilISO(commence_time);

    // outcomes / markets crudos (agrupados)
    const offers = Array.isArray(evento?.bookmakers) ? evento.bookmakers : [];
    const marketsOutcomes = { h2h: [], totals_over: [], totals_under: [], spreads: [] };
    for (const b of offers) {
      const bookie = b?.title || b?.key || '';
      for (const mk of (b?.markets || [])) {
        const mkey = String(mk?.key || '').toLowerCase();
        const outcomes = Array.isArray(mk?.outcomes) ? mk.outcomes : [];
        if (mkey === 'h2h') {
          for (const o of outcomes) {
            marketsOutcomes.h2h.push({ bookie, name: o.name, price: Number(o.price) });
          }
        } else if (mkey === 'totals') {
          // split over/under por point
          for (const o of outcomes) {
            const side = (o?.name || '').toLowerCase().includes('over') ? 'over' : 'under';
            const point = Number(o?.point);
            if (side === 'over') marketsOutcomes.totals_over.push({ bookie, price: Number(o.price), point });
            else marketsOutcomes.totals_under.push({ bookie, price: Number(o.price), point });
          }
        } else if (mkey === 'spreads') {
          for (const o of outcomes) {
            marketsOutcomes.spreads.push({ bookie, price: Number(o.price), point: Number(o?.point), name: o.name });
          }
        }
      }
    }

    const bestH2H = arrBest(marketsOutcomes.h2h);
    const bestTotOver = arrBest(marketsOutcomes.totals_over);
    const bestTotUnder = arrBest(marketsOutcomes.totals_under);
    const bestSpread = arrBest(marketsOutcomes.spreads);

    const anyRecentMin = mins;
    return {
      id,
      commence_time,
      minutosFaltantes: mins,
      home: evento?.home_team || '',
      away: evento?.away_team || '',
      liga: evento?.league || evento?.sport_title || '(por confirmar)',
      marketsBest: {
        h2h: bestH2H ?   { valor: bestH2H.price, label: bestH2H.name } : null,
        totals:{ over: bestTotOver ? { valor: bestTotOver.price, point: bestTotOver.point } : null,
                 under: bestTotUnder ? { valor: bestTotUnder.price, point: bestTotUnder.point } : null },
        spreads: bestSpread ? { valor: bestSpread.price, label: bestSpread.name, point: bestSpread.point } : null
      },
      marketsOffers: {
        h2h: marketsOutcomes.h2h,
        totals_over: marketsOutcomes.totals_over,
        totals_under: marketsOutcomes.totals_under,
        spreads: marketsOutcomes.spreads
      },
      sport_title: evento?.sport_title || '',
      recentMins: anyRecentMin // puede ser null
    };
  } catch (e) {
    console.error('normalizeOddsEvent error:', e?.message || e);
    return null;
  }
}

function arrBest(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.reduce((mx, o) => (o?.price > (mx?.price || -Infinity) ? o : mx), null);
}

function scorePreliminar(p) {
  let score = 0;

  // Bookies activos
  const bookiesSet = new Set([...(p.marketsOffers?.h2h||[]), ...(p.marketsOffers?.totals_over||[]),
    ...(p.marketsOffers?.totals_under||[]), ...(p.marketsOffers?.spreads||[])]
    .map(x => (x?.bookie||'').toLowerCase()).filter(Boolean));
  if (bookiesSet.size >= PREFILTER_MIN_BOOKIES) score += 20;

  // Markets clave presentes
  const hasH2H = (p.marketsOffers?.h2h||[]).length > 0;
  const hasTotals = (p.marketsOffers?.totals_over||[]).length > 0 && (p.marketsOffers?.totals_under||[]).length > 0;
  const hasSpread = (p.marketsOffers?.spreads||[]).length > 0;
  if (hasH2H) score += 15;
  if (hasTotals) score += 10;
  if (hasSpread) score += 5;

  // Recencia (ventana)
  if (Number.isFinite(p.minutosFaltantes) && p.minutosFaltantes >= WINDOW_MAIN_MIN && p.minutosFaltantes <= WINDOW_MAIN_MAX) {
    score += 10;
  }

  // Últimos minutos presentes (por seguridad)
  if (Number.isFinite(p.recentMins) && p.recentMins <= WINDOW_FB_MAX && p.recentMins >= -5) score += 15;

  return score;
}

// =============== API-FOOTBALL ENRIQUECIMIENTO ===============
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
  const list = Array.isArray(data?.response) ? data.response : [];

  // Podrías mapear datos útiles: árbitro, clima, estadio, probables, etc.
  return {
    fixtures_count: list.length
  };
}

// =============== MEMORIA (Supabase) ===============
async function obtenerMemoriaSimilar(partido) {
  try {
    // Lectura acotada — optimizaría con filtros server-side si hay schema de liga/equipos
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
      const okEquipo = (home && eq.includes(home)) || (away && eq.includes(away));
      if (okLiga && okEquipo) out.push(r);
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) {
    console.error('Supabase memoria excepción:', e?.message || e);
    return [];
  }
}

// =============== OPENAI ===============
// === Helper: extraer contenido de forma robusta (SDK v3 y respuestas raras) ===
function extractChoiceContentFromCompletion(completion) {
  try {
    const choice = completion?.data?.choices?.[0] || null;
    if (!choice) return '';
    // ChatCompletion “normal”
    if (choice.message && typeof choice.message.content === 'string') {
      return choice.message.content;
    }
    // Algunas pasarelas/SDK viejos devuelven “text” (estilo Completion)
    if (typeof choice.text === 'string') {
      return choice.text;
    }
    // A veces hay function/tool_calls y NO hay content → tratar como vacío
    return '';
  } catch {
    return '';
  }
}

// === Helper: stringify seguro para logs (recorta objetos grandes) ===
function safePreview(obj, max = 1200) {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? (s.slice(0, max) + '…(trunc)') : s;
  } catch {
    return '[unserializable]';
  }
}

// === Helper: payload OpenAI compatible (gpt-5 / 4o / 4.1 / o3 vs legacy) ===
function buildOpenAIPayload(model, prompt, maxOut = 450, opts = {}) {
  const m = String(model || '').toLowerCase();
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);

  const base = {
    model,
    messages: [{ role: 'user', content: prompt }],
    // n:1 explícito para evitar respuestas raras en algunos gateways
    n: 1
  };

  // jsonMode ON por defecto, pero se puede forzar off en reintentos
  const useJsonMode = opts.jsonMode !== false;
  if (useJsonMode) {
    base.response_format = { type: 'json_object' };
  }

  if (modern) {
    base.max_completion_tokens = maxOut;
  } else {
    base.max_tokens = maxOut;
  }

  // gpt-5 / 4o / o3: deja temperature por default; en legacy, bajamos ruido
  if (!/gpt-5|4o|o3/.test(m)) {
    base.temperature = 0.2;
  }

  return base;
}

// === Helpers: extraer y reparar JSON del modelo ===
function extractFirstJsonBlock(text) {
  if (!text) return null;
  // limpia fences tipo ```json ... ```
  const t = String(text).replace(/```json|```/gi, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = t.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch { return null; }
}

function ensurePickShape(p) {
  if (!p || typeof p !== 'object') p = {};
  return {
    analisis_gratuito: p.analisis_gratuito ?? 's/d',
    analisis_vip: p.analisis_vip ?? 's/d',
    apuesta: p.apuesta ?? '',
    apuestas_extra: p.apuestas_extra ?? '',
    frase_motivacional: p.frase_motivacional ?? 's/d',
    probabilidad: Number.isFinite(p.probabilidad) ? Number(p.probabilidad) : 0,
    no_pick: p.no_pick === true,
    motivo_no_pick: p.motivo_no_pick ?? ''
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
Si algún dato no aparece, coloca "s/d" y para "probabilidad" usa 0.0. Responde SOLO el JSON sin comentarios ni texto adicional.
Contenido:
${rawText || ''}`;

  const completion = await openai.createChatCompletion(
    buildOpenAIPayload(modelo, prompt, 250)
  );
  const content = completion?.data?.choices?.[0]?.message?.content || '';
  return extractFirstJsonBlock(content);
}

// Valida si el pick está completo para VIP (y también sirve para decidir fallback)
function esNoPick(p) { return !!p && p.no_pick === true; }

function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta && typeof p.probabilidad === 'number');
}

async function pedirPickConModelo(modelo, prompt, resumenRef = null) {
  const bumpIntento = () => {
    if (!resumenRef) return;
    resumenRef.oai_calls = (resumenRef.oai_calls || 0) + 1;
    resumenRef.oai_calls_intento = (resumenRef.oai_calls_intento || 0) + 1;
  };

  let raw = '';
  let completion;

  // ========== Intento 1 ==========
  console.log('[OAI] modelo=', modelo, '| intento= 1 / 2');
  console.log('[OAI] prompt.len=', (prompt || '').length);
  bumpIntento();

  try {
    completion = await openai.createChatCompletion(
      buildOpenAIPayload(modelo, prompt, 450)
    );
    if (resumenRef) resumenRef.oai_calls_ok = (resumenRef.oai_calls_ok || 0) + 1;
    // después del intento 1:
    raw = extractChoiceContentFromCompletion(completion) || '';
  } catch (e) {
    console.warn('[OAI] error en intento 1/2:', e?.response?.status, e?.message);
  }

  // ========== Intento 2 si vacío ==========
  if (!raw.trim()) {
    console.warn('[OAI] respuesta vacía en intento 1 → reintentando con refuerzo JSON');
    const promptSoloJson = `${prompt}

IMPORTANTE: Responde SOLO con un JSON válido, sin texto extra, sin comentarios, sin markdown, sin \`\`\`.`;
    console.log('[OAI] modelo=', modelo, '| intento= 2 / 2');
    console.log('[OAI] prompt.len=', (promptSoloJson || '').length);
    bumpIntento();

    try {
      completion = await openai.createChatCompletion(
        buildOpenAIPayload(modelo, promptSoloJson, 450)
      );
      if (resumenRef) resumenRef.oai_calls_ok = (resumenRef.oai_calls_ok || 0) + 1;
      // …y después del intento 2:
      raw = extractChoiceContentFromCompletion(completion) || '';
    } catch (e2) {
      console.warn('[OAI] error en intento 2/2:', e2?.response?.status, e2?.message);
    }
  }

  // ========== Si sigue vacío → no_pick explícito ==========
  // Si ambos intentos vinieron vacíos → devolvemos no_pick explícito
if (!raw || !raw.trim()) {
  console.warn('[OAI][DEBUG] completion.data preview =', safePreview(completion?.data));
  console.warn('[OAI] respuesta realmente vacía tras 2 intentos → devolviendo no_pick');
  const pickNoData = ensurePickShape({
    no_pick: true,
    motivo_no_pick: 'OpenAI devolvió respuesta vacía',
  });
  pickNoData._transport_error = true;
  return pickNoData;
}
  }

  // ========== Parseo JSON ==========
  let obj = extractFirstJsonBlock(raw);

  if (!obj) {
    try {
      obj = await repairPickJSON(modelo, raw);
      if (obj) obj._repaired = true;
      if (obj?._repaired) console.log('[OAI] JSON reparado');
    } catch (e) {
      console.warn('[REPAIR] fallo reformateo:', e?.message || e);
    }
  }

  if (!obj) {
    console.warn('[OAI] sin JSON parseable → devolviendo no_pick');
    return ensurePickShape({
      no_pick: true,
      motivo_no_pick: 'Respuesta no parseable como JSON'
    });
  }

  const pick = ensurePickShape(obj);

  // Logs de control
  if (esNoPick(pick)) {
    console.log('[IA] NO PICK:', pick?.motivo_no_pick || 's/d');
  } else {
    if (!pick.apuesta) console.warn('[IA] falta "apuesta" (sin no_pick)');
    if (typeof pick.probabilidad !== 'number') console.warn('[IA] falta "probabilidad" (sin no_pick)');
  }

  return pick;
}

// === Fallback entre modelos ===
async function obtenerPickConFallback(prompt, resumenRef = null) {
  let pick = await pedirPickConModelo(MODEL, prompt, resumenRef);

  // Si el modelo principal devolvió un no_pick, respetamos y no seguimos
  if (esNoPick(pick)) {
    return { pick, modeloUsado: MODEL };
  }

  // Si el pick viene incompleto o inválido, probamos con el fallback
  if (!pickCompleto(pick)) {
    console.log('♻️ Fallback de modelo →', MODEL_FALLBACK);
    const pick2 = await pedirPickConModelo(MODEL_FALLBACK, prompt, resumenRef);
    return { pick: pick2, modeloUsado: MODEL_FALLBACK };
  }

  // Pick válido con el modelo principal
  return { pick, modeloUsado: MODEL };
}


// =============== PROMPT ===============
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
  const mejoresMercados = [];

  const mH2H = arrBest(offers.h2h);
  if (mH2H) mejoresMercados.push({ marketLabel: '1X2', outcomeLabel: mH2H.name, price: mH2H.price, bookie: mH2H.bookie });
  const mOver = arrBest(offers.totals_over);
  if (mOver) mejoresMercados.push({ marketLabel: 'Total', outcomeLabel: `Más de ${mOver.point}`, price: mOver.price, bookie: mOver.bookie });
  const mUnder = arrBest(offers.totals_under);
  if (mUnder) mejoresMercados.push({ marketLabel: 'Total', outcomeLabel: `Menos de ${mUnder.point}`, price: mUnder.price, bookie: mUnder.bookie });
  const mSpread = arrBest(offers.spreads);
  if (mSpread) mejoresMercados.push({ marketLabel: 'Hándicap', outcomeLabel: mSpread.name, price: mSpread.price, bookie: mSpread.bookie });

  const contexto = {
    liga: partido?.liga || '(por confirmar)',
    equipos: `${partido.home} vs ${partido.away}`,
    hora_relativa: formatMinAprox(Math.max(0, Math.round(partido.minutosFaltantes))),
    info_extra: info,
    memoria: (memoria || []).slice(0,5)
  };

  const opciones_apostables = construirOpcionesApostables(mejoresMercados);
  const prompt = [
    `Eres un analista de apuestas experto. Devuelve SOLO un JSON EXACTO con esta forma:`,
    `{`,
    `  "analisis_gratuito": ""`,
    `  "analisis_vip": ""`,
    `  "apuesta": "",                 // Debe ser EXACTAMENTE una de las opciones_apostables`,
    `  "apuestas_extra": "",          // Opcional`,
    `  "frase_motivacional": ""`,
    `  "probabilidad": 0.0,           // decimal 0.05–0.85`,
    `  "no_pick": false,              // true si NO recomiendas apostar`,
    `  "motivo_no_pick": ""           // breve justificación si no_pick=true`,
    `}`,
    `Reglas:`,
    `- Si "no_pick" = false ⇒ "apuesta" OBLIGATORIA y "probabilidad" ∈ [0.05, 0.85].`,
    `- "apuesta" debe ser EXACTAMENTE una de 'opciones_apostables' listadas abajo (cópiala literal).`,
    `- Si "no_pick" = true ⇒ se permite que "apuesta" esté vacía y "probabilidad" = 0.0.`,
    `- Responde SOLO el JSON sin texto adicional.`,
    ``,
    `Contexto del partido (resumen de datos reales ya pasados: liga, equipos, hora, alineaciones, árbitro, clima, historial, forma, xG, top 3 bookies, memoria 30d, etc.)`,
    JSON.stringify(contexto),
    ``,
    `opciones_apostables (elige UNA y pégala EXACTA en "apuesta"):`,
    ...opciones_apostables.map((s, i) => `${i+1}) ${s}`)
  ].join('\n');

  return prompt;
}

// =============== EV/PROB & CHEQUEOS ===============
function estimarlaProbabilidadPct(pick) {
  if (pick && typeof pick.probabilidad !== 'undefined') {
    const v = Number(pick.probabilidad);
    if (!Number.isNaN(v)) {
      // Aceptamos dos formatos: decimal (0.05–0.85) o porcentaje (5–85)
      if (v > 0 && v < 1) {
        const pct = v * 100;
        if (pct >= 5 && pct <= 85) return +pct.toFixed(2);
        return null;
      } else {
        if (v >= 5 && v <= 85) return +v.toFixed(2);
        return null;
      }
    }
  }
  return null; // no inventar
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
  return +(((p * c) - 1) * 100).toFixed(2);
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
  const seen = new Set();
  return arr.filter(o => Number.isFinite(o?.price))
    .sort((a,b) => b.price - a.price)
    .filter(o => {
      const key = (o?.bookie || '').toLowerCase().trim();
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    })
    .slice(0,3)
    .map(o => ({ bookie: o.bookie, price: Number(o.price), point: (typeof o.point !== 'undefined' ? o.point : null) }));
}

function seleccionarCuotaSegunApuesta(partido, apuesta) {
  const t = String(apuesta || '').toLowerCase();
  const m = partido?.marketsBest || {};
  let selected = null;

  if (t.includes('más de') || t.includes('over') || t.includes('total')) {
    if (m.totals && m.totals.over) selected = { valor: m.totals.over.valor, label: 'over', point: m.totals.over.point };
    else return null; // no cruzar a under
  } else if (t.includes('menos de') || t.includes('under')) {
    if (m.totals && m.totals.under) selected = { valor: m.totals.under.valor, label: 'under', point: m.totals.under.point };
    else return null;
  } else if (t.includes('hándicap') || t.includes('handicap') || t.includes('spread')) {
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
  const a = normalizeStr(apuestaTxt || '');
  const o = normalizeStr(outcomeTxt || '');
  const home = normalizeStr(homeTeam || '');
  const away = normalizeStr(awayTeam || '');

  const esHome = a.includes('1x2: local') || a.includes('local') || a.includes(home);
  const esVisit = a.includes('1x2: visitante') || a.includes('visitante') || a.includes(away);
  if (o.includes('draw') || o.includes('empate')) {
    // empate
    return a.includes('empate') || a.includes('draw');
  }
  if (esHome && (o.includes(away) || o.includes('away'))) return false;
  if (esVisit && (o.includes(home) || o.includes('home'))) return false;

  return true;
}

// =============== MENSAJES ===============
const TAGLINE = '🛰️ IA avanzada monitorea el mercado global 24/7 para detectar valor escondido en el momento justo.';

function construirMensajeVIP(partido, pick, probPct, ev, nivel, cuotaInfo) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const top3Text = Array.isArray(cuotaInfo?.top3) && cuotaInfo.top3.length
    ? `\n📊 Ranking en vivo de cuotas para este partido:\n${cuotaInfo.top3.map((b,i)=>`${i+1}️⃣ ${b.bookie}: ${b.price.toFixed(2)}`).join('\n')}`
    : '';

  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)}${cuotaInfo.point ? ` @ ${cuotaInfo.point}` : ''}`;

  return [
    `🎯 PICK NIVEL: ${nivel}`,
    `🏆 ${COUNTRY_FLAG} ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `🧠 ${pick.analisis_vip}`,
    ``,
    `✅ Apuesta sugerida: ${pick.apuesta}`,
    `🔢 Prob. estimada: ${probPct.toFixed(2)}%`,
    `💰 Cuota usada: ${cuotaTxt}`,
    `📈 EV estimado: ${ev.toFixed(2)}%`,
    top3Text,
    ``,
    `⚠️ Juego responsable · stake acorde a banca`,
    TAGLINE
  ].join('\n');
}

function construirMensajeFREE(partido, pick, probPct, ev, nivel) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  return [
    `📡 RADAR DE VALOR`,
    `🏆 ${COUNTRY_FLAG} ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `${pick.analisis_gratuito}`,
    ``,
    `👉 ¡Únete 15 días gratis al grupo VIP!`,
    `⚠️ Juego responsable`
  ].join('\n');
}

// =============== TELEGRAM ===============
async function enviarFREE(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: TELEGRAM_CHANNEL_ID, text, parse_mode: 'HTML', disable_web_page_preview:true };
    const res = await fetchWithRetry(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }, { retries:2, base:600 });
    if (!res.ok) { console.error('Telegram FREE error:', res.status, await safeText(res)); return false; }
    return true;
  } catch (e) { console.error('Telegram FREE net error:', e?.message || e); return false; }
}

async function enviarVIP(text) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = { chat_id: Number(TELEGRAM_GROUP_ID), text, parse_mode: 'HTML', disable_web_page_preview:true };
    const res = await fetchWithRetry(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) }, { retries:2, base:600 });
    if (!res.ok) { console.error('Telegram VIP error:', res.status, await safeText(res)); return false; }
    return true;
  } catch (e) { console.error('Telegram VIP net error:', e?.message || e); return false; }
}

// =============== SUPABASE SAVE ===============
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

    const { data, error } = await supabase.from(PICK_TABLE).insert([entrada]);
    if (error) { console.error('Supabase insert error:', error.message); return false; }
    return true;
  } catch (e) {
    console.error('Supabase insert excepción:', e?.message || e);
    return false;
  }
}
// ---8<---END FILE---8<---
