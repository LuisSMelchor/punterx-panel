// netlify/functions/autopick-vip-nuevo.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–60 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrails anti-inconsistencias, prefiltro que prioriza sin descartar,
// Telegram con rate-limit handling, Supabase idempotente.

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

console.log("[TEST][AUTODEPLOY] " + new Date().toISOString());

// =============== IMPORTS ===============
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
// [PX-CHANGE] Soporte lectura de template MD
const fs = require('fs');            // [PX-CHANGE]
const path = require('path');        // [PX-CHANGE]

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
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// === Diagnóstico: helpers mínimos (in-file) ===
async function upsertDiagnosticoEstado(status, details) {
  try {
    const payload = {
      fn_name: 'autopick-vip-nuevo',
      status,
      details: details || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('diagnostico_estado')
      .upsert(payload, { onConflict: 'fn_name' });
    if (error) console.warn('[DIAG] upsertDiagnosticoEstado:', error.message);
  } catch (e) {
    console.warn('[DIAG] upsertDiagnosticoEstado(ex):', e?.message || e);
  }
}

async function registrarEjecucion(data) {
  try {
    const row = Object.assign({
      function_name: 'autopick-vip-nuevo',
      created_at: new Date().toISOString()
    }, data);
    const { error } = await supabase
      .from('diagnostico_ejecuciones')
      .insert([row]);
    if (error) console.warn('[DIAG] registrarEjecucion:', error.message);
  } catch (e) {
    console.warn('[DIAG] registrarEjecucion(ex):', e?.message || e);
  }
}
// === Fin helpers diagnóstico ===

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

// [PX-CHANGE] Conversión decimal → momio americano (+125 / -150)
function decimalToAmerican(d) {                 // [PX-CHANGE]
  const dec = Number(d);
  if (!Number.isFinite(dec) || dec <= 1) return 'n/d';
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}                                               // [PX-CHANGE]

// [PX-CHANGE] Emoji por nivel de VIP (para el encabezado)
function emojiNivel(nivel) {                    // [PX-CHANGE]
  const n = String(nivel || '').toLowerCase();
  if (n.includes('ultra')) return '🟣';
  if (n.includes('élite') || n.includes('elite')) return '🎯';
  if (n.includes('avanzado')) return '🥈';
  if (n.includes('competitivo')) return '🥉';
  return '⭐';
}                                               // [PX-CHANGE]

// [PX-CHANGE] Normaliza “apuestas extra” en bullets si viene como texto plano
function formatApuestasExtra(s) {               // [PX-CHANGE]
  const raw = String(s || '').trim();
  if (!raw) return '—';
  const parts = raw.split(/\r?\n|;|\,/).map(x => x.trim()).filter(Boolean);
  return parts.map(x => (x.startsWith('-') ? x : `- ${x}`)).join('\n');
}                                               // [PX-CHANGE]

// =============== NETLIFY HANDLER ===============
exports.handler = async (event, context) => {
  assertEnv();

  const started = Date.now();
  try { await upsertDiagnosticoEstado('running', null); } catch(_) {}
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
          // [PX-CHANGE] Pasamos info de API-Football para enriquecer “Datos a considerar”
          const msg = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo, info); // [PX-CHANGE]
          const ok = await enviarVIP(msg);
          if (ok) { resumen.enviados_vip++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, 'VIP'); }
        } else {
          resumen.intentos_free++;
          const msg = construirMensajeFREE(P, pick, probPct, ev, nivel); // FREE con frase motivacional
          const ok = await enviarFREE(msg);
          if (ok) { resumen.enviados_free++; await guardarPickSupabase(P, pick, probPct, ev, nivel, cuota, 'FREE'); }
        }

      } catch (e) {
        console.error('Procesamiento partido error:', e?.message || e);
      }
    }

    // fin
    return { statusCode: 200, body: JSON.stringify({ ok:true, resumen }) };

  } catch (e) {
    console.error('Error ciclo principal:', e?.message || e);
    try {
      await upsertDiagnosticoEstado('error', e?.message || String(e));
      await registrarEjecucion({
        started_at: new Date(started).toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        ok: false,
        error_message: e?.message || String(e)
      });
    } catch(_) {}
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
  try {
    if (!partido?.home || !partido?.away) {
      console.warn(`[evt:${partido?.id}] Sin equipos → skip enriquecimiento`);
      return {};
    }

    const q = `${partido.home} ${partido.away}`;
    const url = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(q)}`;

    const res = await fetchWithRetry(
      url,
      { headers: { 'x-apisports-key': API_FOOTBALL_KEY } },
      { retries: 1 }
    );

    if (!res || !res.ok) {
      console.error(`[evt:${partido.id}] Football no ok:`, res?.status, await safeText(res));
      return {};
    }

    const data = await safeJson(res);
    if (!data?.response || !Array.isArray(data.response) || data.response.length === 0) {
      console.warn(`[evt:${partido.id}] Sin coincidencias en API-Football`);
      return {};
    }

    // Extraer primer fixture encontrado
    const fixture = data.response[0];
    return {
      fixtures_count: data.response.length,
      fixture_id: fixture?.fixture?.id || null,
      fecha: fixture?.fixture?.date || null,
      estadio: fixture?.fixture?.venue?.name || null,
      ciudad: fixture?.fixture?.venue?.city || null,
      arbitro: fixture?.fixture?.referee || null,
      clima: fixture?.fixture?.weather || null
    };
  } catch (e) {
    console.error(`[evt:${partido?.id}] Error enriquecerPartidoConAPIFootball:`, e?.message || e);
    return {};
  }
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

// Helper para chat.completions (v4/v5): usa max_completion_tokens en modelos modernos
function buildOpenAIPayload(model, prompt, maxOut=450, systemMsg) {
  const m = String(model || '').toLowerCase();
  // Modelos “modernos” que requieren max_completion_tokens
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);

  const base = {
    model,
    response_format: { type: 'json_object' },
    messages: [
      ...(systemMsg ? [{ role: "system", content: systemMsg }] : []),
      { role: "user", content: prompt }
    ],
  };

  // Clave crítica del fix:
  if (modern) base.max_completion_tokens = maxOut;   // ✅ GPT‑5 / 4o / o3
  else base.max_tokens = maxOut;                     // ✅ Modelos anteriores

  // Coherente con el resto del código: temperatura baja en no‑“5/o3”
  if (!/gpt-5|o3/.test(m)) base.temperature = 0.2;

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

  const completion = await openai.chat.completions.create(
    buildOpenAIPayload(modelo, prompt, 250)
  );
  const content = completion?.choices?.[0]?.message?.content || '';
  return extractFirstJsonBlock(content);
}

// Valida si el pick está completo para VIP (y también sirve para decidir fallback)
function esNoPick(p) { return !!p && p.no_pick === true; }

function pickCompleto(p) {
  return !!(p && p.analisis_vip && p.analisis_gratuito && p.apuesta && typeof p.probabilidad === 'number');
}

async function pedirPickConModelo(modelo, prompt) {
  const systemHint = "Responde EXCLUSIVAMENTE un objeto JSON válido. Si no tienes certeza o hay restricciones, responde {\"no_pick\":true,\"motivo_no_pick\":\"sin señal\"}.";
  const req = buildOpenAIPayload(modelo, prompt, 450, systemHint);
  const t0 = Date.now();
  const completion = await openai.chat.completions.create(req);
  const choice = completion?.choices?.[0];
  const raw = choice?.message?.content || "";
  const meta = {
    model: modelo,
    ms: Date.now() - t0,
    finish_reason: choice?.finish_reason || completion?.choices?.[0]?.finish_reason || "n/d",
    usage: completion?.usage || null
  };
  try { console.info("[OAI] meta=", JSON.stringify(meta)); } catch {}
  let obj = extractFirstJsonBlock(raw);
  if (!obj && raw) {
    try { obj = await repairPickJSON(modelo, raw); }
    catch(e){ console.warn("[REPAIR] fallo:", e?.message || e); }
  }
  // Retry corto si vacío o no parseable
  if (!obj) {
    const mini = `Devuelve SOLO este JSON si tienes cualquier duda o falta de datos:
    {"analisis_gratuito":"s/d","analisis_vip":"s/d","apuesta":"","apuestas_extra":"","frase_motivacional":"s/d","probabilidad":0.0,"no_pick":true,"motivo_no_pick":"respuesta vacía o no parseable"}`;
    const req2 = buildOpenAIPayload(modelo, mini, 120, systemHint);
    const c2 = await openai.chat.completions.create(req2);
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
  // Último recurso: no_pick para no romper el ciclo
  if (!pick) {
    pick = ensurePickShape({ no_pick: true, motivo_no_pick: "sin respuesta del modelo" });
  }
  return { pick, modeloUsado: (pick && pick.no_pick) ? MODEL_FALLBACK : MODEL };
}

// =============== PROMPT ===============

// [PX-CHANGE] Lee `prompts_punterx.md` y extrae la sección “1) Pre‑match”
function readFileIfExists(p) {          // [PX-CHANGE]
  try { return fs.readFileSync(p, 'utf8'); } catch(_) { return null; }
}                                       // [PX-CHANGE]

function getPromptTemplateFromMD() {    // [PX-CHANGE]
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
  if (!md) return null;

  // Acepta “Pre-match”, “Pre‑match” (con guion Unicode) y variantes de espacios
  const rx = /^\s*(?:#+\s*)?1\)\s*Pre[ -‑]match\b[\s\S]*?(?=^\s*(?:#+\s*)?\d+\)\s|\Z)/mi;
  const m = md.match(rx);
  if (!m) return null;
  return m[0].trim();
}                                       // [PX-CHANGE]

function renderTemplateWithMarkers(tpl, { contexto, opcionesList }) {  // [PX-CHANGE]
  if (!tpl) return null;
  let out = tpl;

  // Sustitución de marcadores requeridos
  const ctxJson = JSON.stringify(contexto);
  const opciones = (opcionesList || []).map((s, i) => `${i+1}) ${s}`).join('\n');

  out = out.replace(/\{\{\s*CONTEXT_JSON\s*\}\}/g, ctxJson);
  out = out.replace(/\{\{\s*OPCIONES_APOSTABLES_LIST\s*\}\}/g, opciones);

  // Si quedó algún marcador crítico sin resolver, invalida
  if (/\{\{\s*(CONTEXT_JSON|OPCIONES_APOSTABLES_LIST)\s*\}\}/.test(out)) {
    return null;
  }
  return out.trim();
}                                       // [PX-CHANGE]

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

  // [PX-CHANGE] Intentar cargar desde MD (sección 1) Pre‑match) con reemplazo de marcadores
  const tpl = getPromptTemplateFromMD(); // [PX-CHANGE]
  if (tpl) {
    let rendered = renderTemplateWithMarkers(tpl, { contexto, opcionesList: opciones_apostables });
    if (rendered && rendered.length > 0) {
      // Hard-cap de caracteres para evitar silencios por prompts excesivos
      if (rendered.length > 8000) rendered = rendered.slice(0, 8000);
      return rendered;}
  } 
  
  {console.log('[PROMPT] source=md len=', rendered.length); // [PX-CHANGE]
      return rendered; // [PX-CHANGE]
  }
  
  }

  // [PX-CHANGE] Fallback seguro: prompt embebido actual (sin caída)
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

  console.log('[PROMPT] source=fallback len=', prompt.length); // [PX-CHANGE]
  return prompt;

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

// [PX-CHANGE] VIP sin frase motivacional + formato enriquecido (EV | Prob | Momio + Top3 + Datos)
function construirMensajeVIP(partido, pick, probPct, ev, nivel, cuotaInfo, infoExtra) { // [PX-CHANGE]
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const top3Arr = Array.isArray(cuotaInfo?.top3) ? cuotaInfo.top3 : [];
  const american = decimalToAmerican(cuotaInfo?.valor);

  const top3Text = top3Arr.length
    ? [
        '🏆 Mejores 3 casas de apuestas para este partido:',
        ...top3Arr.map((b,i) => {
          const line = `${i+1}. ${b.bookie} — ${Number(b.price).toFixed(2)}`;
          return (i === 0) ? `<b>${line}</b>` : line;
        })
      ].join('\n')
    : '';

  const datos = [];
  if (infoExtra?.clima) datos.push(`- Clima: ${typeof infoExtra.clima === 'string' ? infoExtra.clima : 'disponible'}`);
  if (infoExtra?.arbitro) datos.push(`- Árbitro: ${infoExtra.arbitro}`);
  if (infoExtra?.estadio) datos.push(`- Estadio: ${infoExtra.estadio}${infoExtra?.ciudad ? ` (${infoExtra.ciudad})` : ''}`);
  // Campos avanzados que podrían no estar disponibles:
  // datos.push(`- Lesiones: n/d`);
  // datos.push(`- Historial: n/d`);
  // datos.push(`- xG promedio: n/d`);

  const datosBlock = datos.length ? `\n📊 Datos a considerar:\n${datos.join('\n')}` : '';

  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)}${cuotaInfo.point ? ` @ ${cuotaInfo.point}` : ''}`;

  const encabezadoNivel = `${emojiNivel(nivel)} ${nivel}`;

  return [
    `🎯 PICK NIVEL: ${encabezadoNivel}`,
    `🏆 ${COUNTRY_FLAG} ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    // Análisis VIP breve
    `🧠 ${pick.analisis_vip}`,
    ``,
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
  ].filter(Boolean).join('\n');
}

// [PX-CHANGE] FREE con frase motivacional (💬 “...”) y CTA actualizado
function construirMensajeFREE(partido, pick, probPct, ev, nivel) {        // [PX-CHANGE]
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const motiv = String(pick.frase_motivacional || '').trim();
  const motivLine = motiv && motiv.toLowerCase() !== 's/d' ? `\n💬 “${motiv}”\n` : '\n';

  return [
    `📡 RADAR DE VALOR`,
    `🏆 ${COUNTRY_FLAG} ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
    `${pick.analisis_gratuito}`,
    motivLine.trimEnd(),
    `⏳ Quedan menos de ${Math.max(1, mins)} minutos para este encuentro.`,
    ``,
    `🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.`,
    ``,
    `Únete al VIP para recibir el pick completo con EV, probabilidad, apuestas extra y datos avanzados.`
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
