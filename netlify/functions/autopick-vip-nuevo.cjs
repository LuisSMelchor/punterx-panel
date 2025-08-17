// netlify/functions/autopick-vip-nuevo.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–55 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrail inteligente para picks inválidos.

// [PX-FIX] Imports requeridos
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
// debajo de otros requires en autopick-vip-nuevo.cjs
const { resolveFixtureFromList } = require('./_lib/af-resolver.cjs');

// [PX-FIX] Fin imports requeridos

// [PX-ADD] Resolver de equipos/liga (coincidencias OddsAPI ↔ API-FOOTBALL)
// Carga segura: soporta export default y export nombrado
let resolveTeamsAndLeague = null;
try {
  const mh = require('./_lib/match-helper.cjs');
  resolveTeamsAndLeague = (typeof mh === 'function')
    ? mh
    : (mh && typeof mh.resolveTeamsAndLeague === 'function' ? mh.resolveTeamsAndLeague : null);
  if (!resolveTeamsAndLeague) {
    console.warn('[MATCH-HELPER] Módulo cargado pero sin resolveTeamsAndLeague válido');
  }
} catch (e) {
  console.warn('[MATCH-HELPER] No se pudo cargar:', e?.message || e);
}

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

// [PX-ADD] Flags de auditoría/estricto (inertes si no se configuran en ENV)
const STRICT_MATCH = process.env.STRICT_MATCH === '1';  // exige match AF para seguir con IA/Telegram
const DEBUG_TRACE  = process.env.DEBUG_TRACE === '1';   // trazas detalladas por evento

// [PX-CHANGE] Ventanas por defecto corregidas: 45–55 (antes 40–55)
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
const COUNTRY_FLAG = process.env.COUNTRY_FLAG || '🇲🇽'; // [PX-CHANGE: Default flag changed to Mexico]

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
        console.warn(`[HTTP ${res.status}] retry in ${backoff}ms → ${url}`);
        await sleep(backoff);
        attempt++; continue;
      }
      return res;
    } catch (e) {
      if (attempt >= opts.retries) { console.error('fetchWithRetry error (final):', e?.message || e); throw e; }
      const backoff = opts.base * Math.pow(2, attempt);
      console.warn(`fetchWithRetry net error: ${e?.message || e} → retry in ${backoff}ms`);
      await sleep(backoff);
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
  const parts = raw.split(/\r?\n|;|,/).map(x => x.trim()).filter(Boolean);
  return parts.map(x => (x.startsWith('-') ? x : `- ${x}`)).join('\n');
}                                               // [PX-CHANGE]

// [PX-FIX] Normalizador de evento OddsAPI v4 → shape interno
function normalizeOddsEvent(ev) {
  try {
    const id = ev?.id || `${ev?.commence_time}-${ev?.home_team}-${ev?.away_team}`;
    const home = ev?.home_team || ev?.teams?.home || ev?.home || '';
    const away = ev?.away_team || ev?.teams?.away || ev?.away || '';
    const sport_title = ev?.sport_title || ev?.league?.name || ev?.league || 'Fútbol';
    const commence_time = ev?.commence_time;
    const minutosFaltantes = minutesUntilISO(commence_time);

    const bookmakers = Array.isArray(ev?.bookmakers) ? ev.bookmakers : [];
    const h2h = [], totals_over = [], totals_under = [], spreads = [];

    for (const bk of bookmakers) {
      const bookie = bk?.key || bk?.title || bk?.name || 'bookie';
      const markets = Array.isArray(bk?.markets) ? bk.markets : [];
      for (const m of markets) {
        const key = (m?.key || m?.market || '').toLowerCase();
        const outcomes = Array.isArray(m?.outcomes) ? m.outcomes : [];
        if (key === 'h2h') {
          for (const o of outcomes) {
            h2h.push({ bookie, name: String(o?.name||'').trim(), price: Number(o?.price) });
          }
        } else if (key === 'totals') {
          const point = Number(m?.points ?? m?.point ?? m?.line ?? m?.total);
          for (const o of outcomes) {
            const nm = String(o?.name||'').toLowerCase();
            if (nm.includes('over')) totals_over.push({ bookie, point, price: Number(o?.price) });
            else if (nm.includes('under')) totals_under.push({ bookie, point, price: Number(o?.price) });
          }
        } else if (key === 'spreads') {
          for (const o of outcomes) {
            const pt = Number(o?.point);
            const nm = o?.name || (Number.isFinite(pt) ? (pt>0?`+${pt}`:`${pt}`) : '');
            spreads.push({ bookie, name: String(nm).trim(), price: Number(o?.price), point: pt });
          }
        }
      }
    }
    const bestH2H = arrBest(h2h);
    return {
      id, home, away,
      liga: sport_title, sport_title,
      commence_time, minutosFaltantes,
      marketsOffers: { h2h, totals_over, totals_under, spreads },
      marketsBest: { h2h: bestH2H }
    };
  } catch (e) {
    console.warn('normalizeOddsEvent error:', e?.message || e);
    return null;
  }
}

// =============== NETLIFY HANDLER ===============
exports.handler = async (event, context) => {
  assertEnv();

  // [PX-ADD] Heartbeat de ciclo (ayuda a auditar scheduler/UTC)
  const CICLO_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  console.log(`▶️ CICLO ${CICLO_ID} start; now(UTC)= ${new Date().toISOString()}`);

  const started = Date.now();
  try { await upsertDiagnosticoEstado('running', null); } catch(_) {}
  console.log(`⚙️ Config ventana principal: ${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);

  // Lock simple en memoria por invocación aislada (Netlify)
  if (global.__punterx_lock) {
    console.warn('LOCK activo → salto ciclo');
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true }) };
  }
  global.__punterx_lock = true;
  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0,
    principal: 0, fallback: 0, af_hits: 0, af_fails: 0
  };

  try {
    // 1) Obtener partidos OddsAPI (prefiltro cuotas activas + ventana)
    const base = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&oddsFormat=decimal&markets=h2h,totals,spreads`;
    const url = `${base}&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const tOdds = Date.now();
    const res = await fetchWithRetry(url, { method:'GET' }, { retries: 1, base: 400 });
    const tOddsMs = Date.now() - tOdds;
    if (!res || !res.ok) {
      console.error('OddsAPI error:', res?.status, await safeText(res));
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason:'oddsapi' }) };
    }
    const eventos = await safeJson(res) || [];
    resumen.recibidos = Array.isArray(eventos) ? eventos.length : 0;
    console.log(`ODDSAPI ok=true count=${resumen.recibidos} ms=${tOddsMs}`);

    // Filtrar eventos ya iniciados (minutosFaltantes negativos)
    const eventosUpcoming = (eventos || []).filter(ev => {
       const t = Date.parse(ev.commence_time);
       return Number.isFinite(t) && t > Date.now();
    }); // Sólo eventos por comenzar
    const filteredCount = resumen.recibidos - (Array.isArray(eventosUpcoming) ? eventosUpcoming.length : 0);
    if (filteredCount > 0) {
       console.log(`Filtrados ${filteredCount} eventos ya comenzados (omitidos)`);
    }

    // 2) Normalizar eventos
    const partidos = eventosUpcoming.map(normalizeOddsEvent).filter(Boolean);
    const inWindow = partidos.filter(p => {
      const mins = Math.round(p.minutosFaltantes);
      console.log(`DBG commence_time= ${p.commence_time} mins= ${mins}`);
      const principal = mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX;
      const fallback  = !principal && mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX;
      return principal || fallback;
    });

    // Conteos por ventana y log claro (EN VENTANA vs RECIBIDOS)
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

    // Sub-contadores dentro de la ventana principal
const sub4555 = inWindow.filter(p => {
  const m = Math.round(p.minutosFaltantes);
  return m >= SUB_MAIN_MIN && m <= SUB_MAIN_MAX; // 45–55 por default
}).length;

const subEarly = inWindow.filter(p => {
  const m = Math.round(p.minutosFaltantes);
  return m >= WINDOW_MAIN_MIN && m < SUB_MAIN_MIN; // 40–44 por default
}).length;

// (Opcional) guarda en el resumen para verlos en el JSON final
resumen.principal = principalCount;
resumen.fallback  = fallbackCount;
resumen.sub_45_55 = sub4555;
resumen.sub_40_44 = subEarly;

console.log(
  `📊 Filtrado (OddsAPI): Principal=${principalCount} ` +
  `(45–55=${sub4555}, ${WINDOW_MAIN_MIN}–${SUB_MAIN_MIN-1}=${subEarly}) ` +
  `| Fallback=${fallbackCount} | Total EN VENTANA=${inWindow.length} ` +
  `| Eventos RECIBIDOS=${resumen.recibidos}`
);

    if (!inWindow.length) {
      console.log('OddsAPI: sin partidos en ventana');
      return { statusCode: 200, body: JSON.stringify({ ok:true, resumen }) };
    }

    // 3) Prefiltro ligero (no descarta, solo prioriza)
    const candidatos = inWindow.sort((a,b) => scorePreliminar(b) - scorePreliminar(a)).slice(0, MAX_PER_CYCLE);
    resumen.candidatos = candidatos.length;
    console.log(`OddsAPI: recibidos=${resumen.recibidos}, en_ventana=${resumen.enVentana} (${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX}m)`);

    // 4) Procesar candidatos con enriquecimiento + OpenAI
    let afHits = 0, afFails = 0;
    const tAF = Date.now();

    for (const P of candidatos) {
      const traceId = `[evt:${P.id}]`;
      const abortIfOverBudget = () => {
        if (Date.now() - started > SOFT_BUDGET_MS) throw new Error('Soft budget excedido');
      };

      try {
        abortIfOverBudget();
        // [PX-ADD] Resolver de nombres y liga ANTES de consultar API-FOOTBALL
        try {
          const resolved = resolveTeamsAndLeague
            ? await resolveTeamsAndLeague({
              home: P.home,
              away: P.away,
              sport_title: P.liga || P.sport_title || ''
            })
            : null;
          
          if (resolved) {
            const prevHome = P.home, prevAway = P.away, prevLiga = P.liga;
            if (resolved.home && resolved.home !== P.home) P.home = resolved.home;
            if (resolved.away && resolved.away !== P.away) P.away = resolved.away;
            if (!P.liga && resolved.league) P.liga = resolved.league;
            // Guarda alias para trazabilidad (no se persiste, solo ayuda en logs/prompts)
            if (resolved.aliases) P._aliases = resolved.aliases;
            console.log(
              `[evt:${P.id}] RESOLVE > home="${prevHome}"→"${P.home}" | away="${prevAway}"→"${P.away}" | liga="${prevLiga||'N/D'}"→"${P.liga||'N/D'}"`
            );
          }
        } catch (er) {
          console.warn(`[evt:${P.id}] ResolverTeams warning:`, er?.message || er);
        }

        // A) Enriquecimiento API-FOOTBALL (con backoff mínimo)
        const info = await enriquecerPartidoConAPIFootball(P) || {};
        // Auditoría de match AF (fixture_id presente o no)
        if (info && info.fixture_id) {
          afHits++;
          if (DEBUG_TRACE) {
            console.log('TRACE_MATCH', JSON.stringify({
              ciclo: CICLO_ID, odds_event_id: P.id, fixture_id: info.fixture_id,
              liga: info.liga || P.liga || null, pais: info.pais || P.pais || null
            }));
          }
        } else {
          afFails++;
          if (DEBUG_TRACE) {
            console.log('TRACE_MATCH', JSON.stringify({
              ciclo: CICLO_ID, odds_event_id: P.id, _skip: 'af_no_match',
              home: P.home, away: P.away, liga: P.liga || null
            }));
          }
          if (STRICT_MATCH) {
            console.log(traceId, 'STRICT_MATCH activo → sin AF.fixture_id, descartado antes de IA');
            continue;
          }
        }
        // Propagar país/liga detectados al objeto del partido
        if (info && typeof info === 'object') {
          if (info.pais) P.pais = info.pais;
          if (info.liga) P.liga = info.liga;
        }

        // B) Memoria relevante (máx 5 en client-side)
        const memoria = await obtenerMemoriaSimilar(P);

        // C) Construir prompt maestro con opciones_apostables reales
        const prompt = construirPrompt(P, info, memoria);

        // D) OpenAI (fallback + 1 reintento en cada modelo)
        let pick, modeloUsado = MODEL;
        try {
          const r = await obtenerPickConFallback(prompt);
          pick = r.pick; modeloUsado = r.modeloUsado;
          console.log(traceId, '🔎 Modelo usado:', modeloUsado);
          resumen.oai_calls = (global.__px_oai_calls || 0);
          if (esNoPick(pick)) { console.log(traceId, '🛑 no_pick=true →', pick?.motivo_no_pick || 's/d'); continue; }
          if (!pickCompleto(pick)) { console.warn(traceId, 'Pick incompleto tras fallback'); continue; }
        } catch (e) {
          console.error(traceId, 'Error GPT:', e?.message || e); continue;
        }

        // Selección de cuota EXACTA del mercado pedido
        const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
        if (!cuotaSel || !cuotaSel.valor) { console.warn(traceId, '❌ No se encontró cuota del mercado solicitado → descartando'); continue; }
        const cuota = Number(cuotaSel.valor);

        // Coherencia apuesta/outcome
        const outcomeTxt = String(cuotaSel.label || P?.marketsBest?.h2h?.label || '');
        if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, P.home, P.away)) {
          console.warn(traceId, '❌ Inconsistencia apuesta/outcome → descartando'); continue;
        }

        // Probabilidad (no inventar) + coherencia con implícita
        const probPct = estimarlaProbabilidadPct(pick);
        if (probPct == null) { console.warn(traceId, '❌ Probabilidad ausente → descartando pick'); continue; }
        if (probPct < 5 || probPct > 85) { console.warn(traceId, '❌ Probabilidad fuera de rango [5–85] → descartando pick'); continue; }
        const imp = impliedProbPct(cuota);
        if (imp != null && Math.abs(probPct - imp) > 15) {
          console.warn(traceId, `❌ Probabilidad inconsistente (model=${probPct}%, implícita=${imp}%) → descartando`);
          continue;
        }

        const ev = calcularEV(probPct, cuota);
        if (ev == null) { console.warn(traceId, 'EV nulo'); continue; }
        resumen.procesados++;

        if (ev < 10) { resumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); continue; }

        // Nivel y destino
        const nivel = clasificarPickPorEV(ev);
        const cuotaInfo = { ...cuotaSel, top3: top3ForSelectedMarket(P, pick.apuesta) };
        const destinoVIP = (ev >= 15);

        if (destinoVIP) {
          resumen.intentos_vip++;
          const msg = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo, info);
          const ok = await enviarVIP(msg);
          if (ok) {
            resumen.enviados_vip++;
            await guardarPickSupabase(P, pick, probPct, ev, nivel, cuotaInfo, "VIP");
          }
          const topBookie = (cuotaInfo.top3 && cuotaInfo.top3[0]?.bookie) ? `${cuotaInfo.top3[0].bookie}@${cuotaInfo.top3[0].price}` : `cuota=${cuotaSel.valor}`;
          console.log(ok ? `${traceId} ✅ Enviado VIP | fixture=${info?.fixture_id || 'N/D'} | ${topBookie}` : `${traceId} ⚠️ Falló envío VIP`);
        } else {
          resumen.intentos_free++;
          const msg = construirMensajeFREE(P, pick, probPct, ev, nivel);
          const ok = await enviarFREE(msg);
          if (ok) {
            resumen.enviados_free++;
            await guardarPickSupabase(P, pick, probPct, ev, nivel, null, "FREE");
          }
          console.log(ok ? `${traceId} ✅ Enviado FREE | fixture=${info?.fixture_id || 'N/D'} | cuota=${cuotaSel.valor}` : `${traceId} ⚠️ Falló envío FREE`);
        }

      } catch (e) {
        console.error(traceId, 'Error en loop de procesamiento:', e?.message || e);
      }
    }

    console.log(`AF enrich: hits=${afHits} fails=${afFails} ms=${Date.now()-tAF}`);
    resumen.af_hits = afHits; resumen.af_fails = afFails;

    return { statusCode: 200, body: JSON.stringify({ ok: true, resumen }) };

  } catch (e) {
    console.error('❌ Excepción en ciclo principal:', e?.message || e);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e?.message || 'exception' }) };
  } finally {
    global.__punterx_lock = false;
    try { await upsertDiagnosticoEstado('idle', null); } catch(_) {}
    console.log(`🏁 Resumen ciclo: ${JSON.stringify(resumen)}`);
    console.log(`Duration: ${(Date.now()-started).toFixed(2)} ms\tMemory Usage: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
  }
};

// =============== PRE-FILTER & SCORING ===============
function scorePreliminar(p) {
  let score = 0;

  // Diversidad de bookies y mercados presentes
  const set = new Set([...(p.marketsOffers?.h2h||[]),
                       ...(p.marketsOffers?.totals_over||[]),
                       ...(p.marketsOffers?.totals_under||[]),
                       ...(p.marketsOffers?.spreads||[])]
    .map(x => (x?.bookie||"").toLowerCase()).filter(Boolean));
  if (set.size >= PREFILTER_MIN_BOOKIES) score += 20;

  const hasH2H   = (p.marketsOffers?.h2h||[]).length > 0;
  const hasTotals= (p.marketsOffers?.totals_over||[]).length > 0 && (p.marketsOffers?.totals_under||[]).length > 0;
  const hasSpread= (p.marketsOffers?.spreads||[]).length > 0;
  if (hasH2H)    score += 15;
  if (hasTotals) score += 10;
  if (hasSpread) score += 5;

  // Prioridad temporal dentro de la ventana principal (sin excluir 40–44)
  const mins = Number(p.minutosFaltantes);
  if (Number.isFinite(mins) && mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX) {
    score += 10; // está en principal (40–55 por configuración actual)
    if (mins >= SUB_MAIN_MIN && mins <= SUB_MAIN_MAX) {
      score += 5; // sub-bonus si está en 45–55 (alineaciones/mercado más estables)
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

    // --- Helpers locales (no rompen el scope global)
    const sportTitle = String(partido?.sport_title || partido?.liga || "").trim();
    const afLeagueId = AF_LEAGUE_ID_BY_TITLE[sportTitle] || null;
    const kickoffMs = Date.parse(partido.commence_time || "") || Date.now();
    const kickoffISO = new Date(kickoffMs).toISOString();
    const day = 24 * 3600 * 1000;

    // Normalizador: elimina acentos, abreviaturas y artículos comunes.
    const norm = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(f\.?c\.?|c\.?f\.?|s\.?c\.?|a\.?c\.?|u\.?d\.?|cd|afc|cf|sc|club|deportivo|the|los|las|el|la|de|do|da|unam)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const homeN = norm(partido.home);
    const awayN = norm(partido.away);

    // Tokenización simple para Jaccard
    const tok = (s) => norm(s).split(/\s+/).filter(Boolean);

    // Similaridad por Jaccard con boost si es igualdad exacta tras norm()
    function nameScore(target, candidate) {
      const t = tok(target), c = tok(candidate);
      if (!t.length || !c.length) return 0;
      const setT = new Set(t), setC = new Set(c);
      const inter = [...setT].filter(x => setC.has(x)).length;
      const union = new Set([...setT, ...setC]).size;
      let j = union ? inter / union : 0;
      if (norm(target) === norm(candidate)) j += 1; // boost por igualdad exacta
      if (norm(candidate).includes(norm(target)) || norm(target).includes(norm(candidate))) j += 0.25; // incluye siglas
      return j; // rango aproximado [0..2.25]
    }

    function fixtureScore(fx, homeName, awayName) {
      const th = fx?.teams?.home?.name || "";
      const ta = fx?.teams?.away?.name || "";
      const direct = nameScore(homeName, th) + nameScore(awayName, ta);
      const swapped = nameScore(homeName, ta) + nameScore(awayName, th);
      const dt2 = Date.parse(fx?.fixture?.date || "");
      const deltaH = Number.isFinite(dt2) ? Math.abs(dt2 - kickoffMs) / 3600000 : 999;
      const timeBoost = deltaH <= 36 ? 0.25 : 0; // dentro de la ventana ±36h
      return Math.max(direct, swapped) + timeBoost;
    }

    function selectBestFixture(arr, homeName, awayName, whyTag) {
      if (!Array.isArray(arr) || !arr.length) return null;
      const scored = arr.map(x => ({ x, score: fixtureScore(x, homeName, awayName) }))
                        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best || !best.x) return null;
      if (best.score < 0.9) {
        console.warn(`[evt:${partido?.id}] Puntaje bajo (${best.score.toFixed(2)}) para mejor candidato (${whyTag})`);
      }
      return best.x;
    }

    // === 1) PRIMARIO: fixtures por LIGA + FECHA exacta (UTC)
    try {
      const dateStr = new Date(kickoffMs).toISOString().slice(0,10);
      if (afLeagueId) {
        const url = `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(dateStr)}&league=${encodeURIComponent(afLeagueId)}&timezone=UTC`;
        const res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
        if (res?.ok) {
          const data = await safeJson(res);
          const arr = Array.isArray(data?.response) ? data.response : [];
          // Heurística rápida por nombre/fecha ±60h
          const candidates = arr
            .filter(x => {
              const dt2 = Date.parse(x?.fixture?.date || "");
              if (!Number.isFinite(dt2)) return true;
              const diffH = Math.abs((dt2 - kickoffMs)/3600000);
              return diffH <= 60;
            })
            .map(x => {
              const th = norm(x?.teams?.home?.name);
              const ta = norm(x?.teams?.away?.name);
              const ns = ((th===homeN && ta===awayN) || (th===awayN && ta===homeN)) ? 2 :
                         (th.includes(homeN)||ta.includes(awayN)||th.includes(awayN)||ta.includes(homeN) ? 1 : 0);
              return { x, nameScore: ns };
            })
            .sort((a,b)=> b.nameScore - a.nameScore);
          let best = candidates[0]?.nameScore ? candidates[0]?.x : null;

          // Resolver por similitud si no confía la heurística
          if (!best || candidates[0]?.nameScore < 2) {
            const resolved = resolveFixtureFromList(partido, arr);
            if (resolved) {
              best = resolved;
              console.log(`[evt:${partido?.id}] Resolver AF (league+date): fixture_id=${resolved?.fixture?.id} league="${resolved?.league?.name}"`);
            }
          }
          if (best) {
            return {
              liga: best?.league?.name || sportTitle || null,
              pais: best?.league?.country || null,
              fixture_id: best?.fixture?.id || null,
              fecha: best?.fixture?.date || null,
              estadio: best?.fixture?.venue?.name || null,
              ciudad: best?.fixture?.venue?.city || null,
              arbitro: best?.fixture?.referee || null,
              clima: best?.fixture?.weather || null
            };
          }
        } else if (res) {
          console.warn(`[evt:${partido?.id}] AF fixtures league+date falló:`, res.status, await safeText(res));
        }
      }
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error league+date:`, e?.message || e);
    }

    // === 2) SECUNDARIO: fixtures por LIGA en ventana ±2 días (UTC)
    if (afLeagueId) {
      try {
        const from = new Date(kickoffMs - 2 * day).toISOString().slice(0, 10);
        const to = new Date(kickoffMs + 2 * day).toISOString().slice(0, 10);
        const url = `https://v3.football.api-sports.io/fixtures?league=${encodeURIComponent(afLeagueId)}&from=${from}&to=${to}&timezone=UTC`;
        const res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
        if (res?.ok) {
          const j = await safeJson(res);
          const arr = Array.isArray(j?.response) ? j.response : [];
          const best = selectBestFixture(arr, partido.home, partido.away, `league+window±2d (id=${afLeagueId}, ${from}..${to})`);
          if (best) {
            return {
              liga: best?.league?.name || sportTitle || null,
              pais: best?.league?.country || null,
              fixture_id: best?.fixture?.id || null,
              fecha: best?.fixture?.date || null,
              estadio: best?.fixture?.venue?.name || null,
              ciudad: best?.fixture?.venue?.city || null,
              arbitro: best?.fixture?.referee || null,
              clima: best?.fixture?.weather || null
            };
          }
        }
      } catch (e) {
        console.warn(`[evt:${partido?.id}] Error league±2d:`, e?.message || e);
      }
    }

    // === 3) TERCER INTENTO: búsqueda textual (menos preciso)
    try {
      const q = `${partido.home} ${partido.away}`;
      const url = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(q)}&timezone=UTC`;
      const res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
      if (!res?.ok) {
        console.warn(`[evt:${partido?.id}] AF search error:`, res?.status, await safeText(res));
      } else {
        const j = await safeJson(res);
        let arr = Array.isArray(j?.response) ? j.response : [];
        if (!arr.length) {
          console.warn(`[evt:${partido.id}] Sin coincidencias search="${q}", homeN="${homeN}", awayN="${awayN}"`);
          // Fallback adicional: intentar búsqueda por cada equipo (home/away)
          const tryOne = async (name) => {
            const u = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(name)}&timezone=UTC`;
            const r = await fetchWithRetry(u, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }, { retries: 1 });
            if (!r?.ok) return [];
            const jj = await safeJson(r);
            return Array.isArray(jj?.response) ? jj.response : [];
          };
          const arrH = await tryOne(partido.home);
          const arrA = await tryOne(partido.away);
          arr = [...arrH, ...arrA];
        }

        // Filtra por cercanía temporal ±48h
        const filtered = arr.filter(x => {
          const dt2 = Date.parse(x?.fixture?.date || "");
          if (!Number.isFinite(dt2)) return true;
          const diffH = Math.abs((dt2 - kickoffMs) / 3600000);
          return diffH <= 48;
        });

        const best = selectBestFixture(filtered, partido.home, partido.away, "search");
        if (best) {
          return {
            liga: best?.league?.name || sportTitle || null,
            pais: best?.league?.country || null,
            fixture_id: best?.fixture?.id || null,
            fecha: best?.fixture?.date || null,
            estadio: best?.fixture?.venue?.name || null,
            ciudad: best?.fixture?.venue?.city || null,
            arbitro: best?.fixture?.referee || null,
            clima: best?.fixture?.weather || null
          };
        }
      }
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error search:`, e?.message || e);
    }

    // === 4) ÚLTIMO RECURSO: resolver IDs de equipos y consultar H2H en ±2 días ===
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
          return { id: x?.team?.id, score: nameScore(target, nm) };
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
              clima: fx?.fixture?.weather || null
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error H2H ±2d:`, e?.message || e);
    }

    // Si todo falla:
    console.warn(`[evt:${partido?.id}] Sin coincidencias en API-Football (kickoff=${kickoffISO}, homeN="${homeN}", awayN="${awayN}")`);
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
  const match = text.match(/\{[\s\S]*\}/);
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
  // Ajuste de tokens: arranque bajo y retry controlado
  let tokens = 320; // arranque más bajo para evitar 'length' y timeouts

  // 1er intento
  let req = buildOpenAIPayload(modelo, prompt, tokens, systemHint);
  try {
    const t0 = Date.now();
    const completion = await openai.chat.completions.create(req);
    global.__px_oai_calls = (global.__px_oai_calls||0) + 1;
    const choice = completion?.choices?.[0];
    const raw = choice?.message?.content || "";
    const meta = {
      model: modelo,
      ms: Date.now() - t0,
      finish_reason: choice?.finish_reason || completion?.choices?.[0]?.finish_reason || "n/d",
      usage: completion?.usage || null
    };
    try { console.info("[OAI] meta=", JSON.stringify(meta)); } catch {}

    if (meta.finish_reason === 'length') {
      tokens = Math.min(tokens + 80, 400); // retry corto y techo bajo
      req = buildOpenAIPayload(modelo, prompt, tokens, systemHint);
      if (req.response_format) delete req.response_format;
      const c2 = await openai.chat.completions.create(req);
      global.__px_oai_calls = (global.__px_oai_calls||0) + 1;
      const raw2 = c2?.choices?.[0]?.message?.content || "";
      const obj2 = extractFirstJsonBlock(raw2) || await repairPickJSON(modelo, raw2);
      return obj2 ? ensurePickShape(obj2) : null;
    }

    const obj = extractFirstJsonBlock(raw) || await repairPickJSON(modelo, raw);
    return obj ? ensurePickShape(obj) : null;

  } catch (e) {
    const msg = String(e?.message || '');
    if (/unknown parameter|unsupported parameter|response_format/i.test(msg)) {
      try {
        const req2 = buildOpenAIPayload(modelo, prompt, tokens, systemHint);
        if (req2.response_format) delete req2.response_format;
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

  // Acepta “Pre-match/Pre–match” (guiones Unicode o ASCII) y variantes
  const rx = /^\s*(?:#+\s*)?1\)\s*Pre[\-– ]match\b[\s\S]*?(?=^\s*(?:#+\s*)?\d+\)\s|\Z)/mi;
  const m = md.match(rx);
  if (!m) return null;
  return m[0].trim();
}

function renderTemplateWithMarkers(tpl, { contexto, opcionesList }) {
  if (!tpl) return null;
  let out = tpl;

  const ctxJson = JSON.stringify(contexto);
  const opciones = (opcionesList || []).map((s, i) => `${i+1}) ${s}`).join('\n');

  out = out.replace(/\{\{\s*CONTEXT_JSON\s*\}\}/g, ctxJson);
  out = out.replace(/\{\{\s*OPCIONES_APOSTABLES_LIST\s*\}\}/g, opciones);

  if (/\{\{\s*(CONTEXT_JSON|OPCIONES_APOSTABLES_LIST)\s*\}\}/.test(out)) {
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
    ``,
    JSON.stringify(contexto),
    ``,
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

// =============== MENSAJES (formatos) ===============
function construirMensajeVIP(partido, pick, probPct, ev, nivel, cuotaInfo, infoExtra) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const top3Arr = Array.isArray(cuotaInfo?.top3) ? cuotaInfo.top3 : [];
  const american = decimalToAmerican(cuotaInfo?.valor);

  const top3Text = top3Arr.length
    ? [
        '🏆 Mejores 3 casas de apuestas para este partido:',
        ...top3Arr.map((b,i) => {
          const line = `${b.bookie} — ${Number(b.price).toFixed(2)}`;
          return i === 0 ? `<b>${line}</b>` : line;
        })
      ].join('\n')
    : '';

  const datos = [];
  if (infoExtra?.clima)   datos.push(`- Clima: ${typeof infoExtra.clima === 'string' ? infoExtra.clima : 'disponible'}`);
  if (infoExtra?.arbitro) datos.push(`- Árbitro: ${infoExtra.arbitro}`);
  if (infoExtra?.estadio) datos.push(`- Estadio: ${infoExtra.estadio}${infoExtra?.ciudad ? ` (${infoExtra.ciudad})` : ''}`);
  const datosBlock = datos.length ? `\n📊 Datos a considerar:\n${datos.join('\n')}` : '';

  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)}${cuotaInfo.point ? ` @ ${cuotaInfo.point}` : ''}`;
  const encabezadoNivel = `${emojiNivel(nivel)} ${nivel}`;

  return [
    `🎯 PICK NIVEL: ${encabezadoNivel}`,
    `🏆 ${COUNTRY_FLAG} ${(infoExtra?.pais || partido?.pais || 'N/D')} - ${partido.liga}`,
    `⚔️ ${partido.home} vs ${partido.away}`,
    `⏱️ ${formatMinAprox(mins)}`,
    ``,
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

function construirMensajeFREE(partido, pick, probPct, ev, nivel) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  const motiv = String(pick.frase_motivacional || '').trim();
  const motivLine = motiv && motiv.toLowerCase() !== 's/d' ? `\n💬 “${motiv}”\n` : '\n';

  return [
    `📡 RADAR DE VALOR`,
    `🏆 ${COUNTRY_FLAG} ${(infoFromPromptPais(partido) || 'N/D')} - ${partido.liga}`,
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

// Helper FREE
function infoFromPromptPais(partido) {
  return partido?.pais || null;
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
async function guardarPickSupabase(partido, pick, probPct, ev, nivel, cuotaInfoOrNull, tipo) {
  try {
    const evento = `${partido.home} vs ${partido.away} (${partido.liga})`;
    const entrada = {
      evento,
      analisis: `${pick.analisis_gratuito}\n---\n${pick.analisis_vip}`,
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
    if (tipo !== 'LIVE') {
      entrada.top3_json = (Array.isArray(cuotaInfoOrNull?.top3) ? cuotaInfoOrNull.top3 : null);
    }

    // top3_json también en PRE (si se dispone del arreglo)
    if (cuotaInfoOrNull && Array.isArray(cuotaInfoOrNull.top3)) {
      entrada.top3_json = cuotaInfoOrNull.top3;
    }

    if (tipo === 'LIVE') {
      entrada.is_live = true;
      entrada.kickoff_at = partido.commence_time || null;
      entrada.minute_at_pick = partido.minute || null;
      entrada.phase = partido.phase || null;
      entrada.score_at_pick = partido.score || null;
      // [PX-FIX] corregido: usar "partido" y no variable inexistente "party"
      entrada.market_point = (partido.pickPoint != null) ? String(partido.pickPoint) : null;
      entrada.vigencia_text = partido.vigenciaText || null;
    }

    const { data: dupRow, error: dupErr } = await supabase
      .from(PICK_TABLE).select('id').eq('evento', evento).limit(1).maybeSingle();
    if (dupErr) { console.warn('Supabase dup check error:', dupErr?.message); }
    if (!dupRow) {
      const { error } = await supabase.from(PICK_TABLE).insert([ entrada ]);
      if (error) {
        console.error('Supabase insert error:', error.message);
        resumen.guardados_fail++;
      } else {
        resumen.guardados_ok++;
      }
    } else {
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

  const isG5 = /(^|\b)gpt-5(\b|-)/i.test(String(model||''));
  const payload = { model, messages };

  if (isG5) {
    // Mantén el tope de salida compacto para no agotar 30s
    const wanted = Number(maxTokens) || 320;
    payload.max_completion_tokens = Math.min(Math.max(260, wanted), 380);
    payload.response_format = { type: "json_object" };
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

  const fixerModel = (String(model||'').toLowerCase().includes('gpt-5')) ? 'gpt-5-mini' : model;
  const isG5 = /(^|\b)gpt-5(\b|-)/i.test(String(fixerModel||''));

  const fixReq = {
    model: fixerModel,
    messages: [{ role:'user', content: prompt }]
  };

  if (isG5) {
    fixReq.max_completion_tokens = 300;
  } else {
    fixReq.temperature = 0.2;
    fixReq.top_p = 1;
    fixReq.presence_penalty = 0;
    fixReq.frequency_penalty = 0;
    fixReq.max_tokens = 300;
  }

  const res = await openai.chat.completions.create(fixReq);
  const raw = res?.choices?.[0]?.message?.content || "";
  return extractFirstJsonBlock(raw);
}

// Aux: obtener mejor cuota de un array
function arrBest(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.reduce((acc, x) => (x.price && (!acc || x.price > acc.price) ? x : acc), null);
}

// AF league mapping (mínimo para mejorar aciertos por liga+fecha)
const AF_LEAGUE_ID_BY_TITLE = {
  "England - Premier League": 39,
  "Spain - La Liga": 140,
  "Italy - Serie A": 135,
  "Germany - Bundesliga": 78,
  "France - Ligue 1": 61,
  "Mexico - Liga MX": 262,
  "Brazil - Serie A": 71,
  "Argentina - Liga Profesional": 128
};

const TAGLINE = "🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.";
