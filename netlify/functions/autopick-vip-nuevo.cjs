// netlify/functions/autopick-vip-nuevo.cjs
// PunterX · Autopick v4 — Cobertura mundial fútbol con ventana 45–55 (fallback 35–70), backpressure,
// modelo OpenAI 5 con fallback y reintento, guardrail inteligente para picks inválidos.
// + Corazonada IA integrada (helpers, cálculo, visualización y guardado en Supabase)
// + Snapshots de cuotas (odds_prev_best) para señal de mercado (lectura y escritura)

'use strict';

const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { resolveFixtureFromList } = require('./_lib/af-resolver.cjs');
// Corazonada (tu módulo ya existente)
const { computeCorazonada } = require('./_corazonada.cjs');

// Resolver de equipos/liga (coincidencias OddsAPI ↔ API-FOOTBALL) — carga segura
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

async function acquireDistributedLock(ttlSeconds = 120) {
  try {
    const now = Date.now();
    const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();

    // 1) Intento de insert (si existe → 23505)
    const { error: insErr } = await supabase
      .from(LOCK_TABLE)
      .insert([{ lock_key: LOCK_KEY_FN, expires_at: expiresAt }]);

    if (!insErr) return true;

    // 2) Si hay conflicto, consulta el lock actual
    if (String(insErr.code) === '23505') {
      const { data: row, error: selErr } = await supabase
        .from(LOCK_TABLE)
        .select('expires_at')
        .eq('lock_key', LOCK_KEY_FN)
        .maybeSingle();

      if (selErr) return false;

      const exp = Date.parse(row?.expires_at || 0);
      if (!Number.isFinite(exp) || exp <= now) {
        // 3) Si expiró, reemplaza (upsert)
        const { error: upErr } = await supabase
          .from(LOCK_TABLE)
          .upsert({ lock_key: LOCK_KEY_FN, expires_at: expiresAt }, { onConflict: 'lock_key' });
        return !upErr;
      }
      return false; // lock vigente por otro proceso
    }

    return false;
  } catch (e) {
    console.warn('[LOCK] acquire error:', e?.message || e);
    return false;
  }
}

async function releaseDistributedLock() {
  try {
    await supabase.from(LOCK_TABLE).delete().eq('lock_key', LOCK_KEY_FN);
  } catch (e) {
    console.warn('[LOCK] release error:', e?.message || e);
  }
}

// =============== CONFIG MODELOS ===============
const MODEL = (process.env.OPENAI_MODEL || OPENAI_MODEL || 'gpt-5-mini');
const MODEL_FALLBACK = (process.env.OPENAI_MODEL_FALLBACK || 'gpt-5');

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

// Conversión decimal → momio americano (+125 / -150)
function decimalToAmerican(d) {
  const dec = Number(d);
  if (!Number.isFinite(dec) || dec <= 1) return 'n/d';
  if (dec >= 2) return `+${Math.round((dec - 1) * 100)}`;
  return `-${Math.round(100 / (dec - 1))}`;
}

// Emoji por nivel de VIP (para el encabezado)
function emojiNivel(nivel) {
  const n = String(nivel || '').toLowerCase();
  if (n.includes('ultra')) return '🟣';
  if (n.includes('élite') || n.includes('elite')) return '🎯';
  if (n.includes('avanzado')) return '🥈';
  if (n.includes('competitivo')) return '🥉';
  return '⭐';
}

// Normaliza “apuestas extra” en bullets si viene como texto plano
function formatApuestasExtra(s) {
  const raw = String(s || '').trim();
  if (!raw) return '—';
  const parts = raw.split(/\r?\n|;|,/).map(x => x.trim()).filter(Boolean);
  return parts.map(x => (x.startsWith('-') ? x : `- ${x}`)).join('\n');
}

// Aux: obtener mejor cuota de un array
function arrBest(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.reduce((acc, x) => (x.price && (!acc || x.price > acc.price) ? x : acc), null);
}

// =============== NORMALIZADOR ODDSAPI ===============
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

// =============== SNAPSHOTS (odds_prev_best) ===============
// Normaliza clave de mercado para snapshots
function mapMarketKeyForSnapshotFromApuesta(apuesta) {
  const s = String(apuesta || '').toLowerCase();
  if (/over|under|total|más de|menos de|mas de/.test(s)) return 'totals';
  if (/handicap|spread/.test(s)) return 'spreads';
  return 'h2h';
}

// Guardar snapshot de la mejor cuota del mercado/outcome seleccionado
async function saveOddsSnapshot({ event_key, fixture_id, market, outcome_label, point, best_price, best_bookie, top3_json }) {
  try {
    const row = {
      event_key: String(event_key || ''),
      fixture_id: Number.isFinite(fixture_id) ? fixture_id : null,
      market: String(market || 'h2h'),
      outcome_label: String(outcome_label || ''),
      point: (point != null && Number.isFinite(Number(point))) ? Number(point) : null,
      best_price: Number(best_price),
      best_bookie: best_bookie ? String(best_bookie) : null,
      top3_json: Array.isArray(top3_json) ? top3_json : null
    };
    if (!row.event_key || !row.market || !row.outcome_label || !Number.isFinite(row.best_price) || row.best_price <= 1) return false;

    const { error } = await supabase.from(ODDS_SNAPSHOTS_TABLE).insert([row]);
    if (error) { console.warn('[SNAPSHOT] insert error:', error.message); return false; }
    return true;
  } catch (e) {
    console.warn('[SNAPSHOT] exception:', e?.message || e);
    return false;
  }
}

// Obtener best price PREVIO con lookback (minutos)
async function getPrevBestOdds({ event_key, market, outcome_label, point, lookbackMin }) {
  try {
    const cutoffISO = new Date(Date.now() - Math.max(1, lookbackMin || ODDS_PREV_LOOKBACK_MIN) * 60000).toISOString();

    let q = supabase
      .from(ODDS_SNAPSHOTS_TABLE)
      .select('best_price,captured_at')
      .eq('event_key', String(event_key || ''))
      .eq('market', String(market || 'h2h'))
      .eq('outcome_label', String(outcome_label || ''))
      .lt('captured_at', cutoffISO)
      .order('captured_at', { ascending: false })
      .limit(1);

    if (point != null && Number.isFinite(Number(point))) q = q.eq('point', Number(point)); else q = q.is('point', null);

    const { data, error } = await q;
    if (error) { console.warn('[SNAPSHOT] select error:', error.message); return null; }
    const r = Array.isArray(data) && data[0] ? data[0] : null;
    return r ? Number(r.best_price) : null;
  } catch (e) {
    console.warn('[SNAPSHOT] select exception:', e?.message || e);
    return null;
  }
}

// =============== NETLIFY HANDLER ===============
exports.handler = async (event, context) => {
  assertEnv();

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

  // Lock distribuido
  const gotLock = await acquireDistributedLock(120);
  if (!gotLock) {
    console.warn('LOCK distribuido activo → salto ciclo');
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true, reason:'lock' }) };
  }

  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0,
    principal: 0, fallback: 0, af_hits: 0, af_fails: 0
  };

  try {
    // 1) Obtener partidos OddsAPI
    // Construcción sin template strings para evitar errores de comillas/backticks
    const base = 'https://api.the-odds-api.com/v4/sports/' + sportKey + '/odds';
    const url =
      base +
      '?apiKey=' + encodeURIComponent(ODDS_API_KEY) +
      '&regions=' + encodeURIComponent(ODDS_REGIONS) +
      '&oddsFormat=decimal' +
      '&markets=h2h,totals,spreads';
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

    // Filtrar ya iniciados
    const eventosUpcoming = (eventos || []).filter(ev => {
      const t = Date.parse(ev.commence_time);
      return Number.isFinite(t) && t > Date.now();
    });

    // 2) Normalizar
    const partidos = eventosUpcoming.map(normalizeOddsEvent).filter(Boolean);

    // Filtrar por ventana
    const inWindow = partidos.filter(p => {
      const mins = Math.round(p.minutosFaltantes);
      const principal = mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX;
      const fallback  = !principal && mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX;
      return principal || fallback;
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

    const sub4555 = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return m >= SUB_MAIN_MIN && m <= SUB_MAIN_MAX; // 45–55
    }).length;
    const subEarly = inWindow.filter(p => {
      const m = Math.round(p.minutosFaltantes);
      return m >= WINDOW_MAIN_MIN && m < SUB_MAIN_MIN; // 40–44 si aplicara
    }).length;
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

    // 3) Prefiltro ligero (prioriza, no descarta)
    const candidatos = inWindow
      .sort((a,b) => scorePreliminar(b) - scorePreliminar(a))
      .slice(0, MAX_PER_CYCLE);

    resumen.candidatos = candidatos.length;

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

        // Resolver nombres/ligas antes de API-FOOTBALL
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
            if (resolved.aliases) P._aliases = resolved.aliases;
            console.log(
              `[evt:${P.id}] RESOLVE > home="${prevHome}"→"${P.home}" | away="${prevAway}"→"${P.away}" | liga="${prevLiga||'N/D'}"→"${P.liga||'N/D'}"`
            );
          }
        } catch (er) {
          console.warn(`[evt:${P.id}] ResolverTeams warning:`, er?.message || er);
        }

        // A) Enriquecimiento API-FOOTBALL
        const info = await enriquecerPartidoConAPIFootball(P) || {};
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
          
          // ... tras intentar resolver el fixture AF:
          if (STRICT_MATCH && !(fixtureAF && fixtureAF.fixture && fixtureAF.fixture.id)) {
          logger && logger.warn && logger.warn(traceId, 'STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO');
          continue; // o "return null" si estás en una función que procesa 1 evento
          }
          }

        // Propagar país/liga detectados
        if (info && typeof info === 'object') {
          if (info.pais) P.pais = info.pais;
          if (info.liga) P.liga = info.liga;
        }

        // B) Memoria relevante (máx 5)
        const memoria = await obtenerMemoriaSimilar(P);

        // C) Prompt maestro con opciones apostables reales
        const prompt = construirPrompt(P, info, memoria);

        // D) OpenAI (fallback + retries defensivos)
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

        // Seleccionar cuota EXACTA del mercado pedido
        const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
        if (!cuotaSel || !cuotaSel.valor) { console.warn(traceId, '❌ No se encontró cuota del mercado solicitado → descartando'); continue; }
        const cuota = Number(cuotaSel.valor);

        // Coherencia apuesta/outcome
        const outcomeTxt = String(cuotaSel.label || P?.marketsBest?.h2h?.label || '');
        if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, P.home, P.away)) {
          console.warn(traceId, '❌ Inconsistencia apuesta/outcome → descartando'); continue;
        }

        // Probabilidad + coherencia con implícita
        const probPct = estimarlaProbabilidadPct(pick);
        if (probPct == null) { console.warn(traceId, '❌ Probabilidad ausente → descartando pick'); continue; }
        if (probPct < 5 || probPct > 85) { console.warn(traceId, '❌ Probabilidad fuera de rango [5–85] → descartando pick'); continue; }
        const imp = impliedProbPct(cuota);
        if (imp != null && Math.abs(probPct - imp) > 15) {
          console.warn(traceId, `❌ Probabilidad inconsistente (model=${probPct}%, implícita=${imp}%) → descartando`);
          continue;
        }

        // EV
        const ev = calcularEV(probPct, cuota);
        if (ev == null) { console.warn(traceId, 'EV nulo'); continue; }
        resumen.procesados++;
        if (ev < 10) { resumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); continue; }

        // === Señal de mercado: snapshot NOW y lookup PREV ===
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
        } catch (e) {
          console.warn(traceId, '[SNAPSHOT] NOW warn:', e?.message || e);
        }

        // === Corazonada IA (si habilitada) ===
        let cz = { score: 0, motivo: '' };
        try {
          if (CORAZONADA_ENABLED) {
            const side = inferPickSideFromApuesta(pick.apuesta);
            const market = inferMarketFromApuesta(pick.apuesta);

            // oddsNow (best), oddsPrev (best) vía snapshots:
            const oddsNowBest = (cuotaSel && Number(cuotaSel.valor)) || null;

            const oddsPrevBest = await getPrevBestOdds({
              event_key: P.id,
              market: mapMarketKeyForSnapshotFromApuesta(pick.apuesta),
              outcome_label: String(pick.apuesta || ''),
              point: (cuotaSel.point != null) ? cuotaSel.point : null,
              lookbackMin: ODDS_PREV_LOOKBACK_MIN
            });

            // Para computeCorazonada necesitamos xg/availability/contexto
            const xgStats = buildXgStatsFromAF(info);           // ajusta si tu objeto AF difiere
            const availability = buildAvailabilityFromAF(info);
            const context = buildContextFromAF(info);

            const cora = computeCorazonada({
              pick: { side, market },
              oddsNow: { best: oddsNowBest },
              oddsPrev: { best: oddsPrevBest },
              xgStats,
              availability,
              context
            });
            cz = { score: cora?.score || 0, motivo: String(cora?.motivo || '').trim() };
          }
        } catch (e) {
          console.warn(traceId, '[Corazonada] excepción:', e?.message || e);
        }

        // Nivel y destino
        const nivel = clasificarPickPorEV(ev);
        const cuotaInfo = { ...cuotaSel, top3: top3ForSelectedMarket(P, pick.apuesta) };
        const destinoVIP = (ev >= 15);

        if (destinoVIP) {
          resumen.intentos_vip++;
          const msg = construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo, info, cz);
          const ok = await enviarVIP(msg);
          if (ok) {
            resumen.enviados_vip++;
            await guardarPickSupabase(P, pick, probPct, ev, nivel, cuotaInfo, "VIP", cz);
          }
          const topBookie = (cuotaInfo.top3 && cuotaInfo.top3[0]?.bookie) ? `${cuotaInfo.top3[0].bookie}@${cuotaInfo.top3[0].price}` : `cuota=${cuotaSel.valor}`;
          console.log(ok ? `${traceId} ✅ Enviado VIP | fixture=${info?.fixture_id || 'N/D'} | ${topBookie}` : `${traceId} ⚠️ Falló envío VIP`);
        } else {
          resumen.intentos_free++;
          const msg = construirMensajeFREE(P, pick, probPct, ev, nivel, cz);
          const ok = await enviarFREE(msg);
          if (ok) {
            resumen.enviados_free++;
            await guardarPickSupabase(P, pick, probPct, ev, nivel, null, "FREE", cz);
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
    try { await releaseDistributedLock(); } catch(_) {}
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
      const direct = nameScore(homeName, th) + nameScore(awayName, ta);
      const swapped = nameScore(homeName, ta) + nameScore(awayName, th);
      const dt2 = Date.parse(fx?.fixture?.date || "");
      const deltaH = Number.isFinite(dt2) ? Math.abs(dt2 - kickoffMs) / 3600000 : 999;
      const timeBoost = deltaH <= 36 ? 0.25 : 0;
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
              weather: best?.fixture?.weather || null, // algunos providers
              xg: null, availability: null // reservados para builders locales
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
              weather: best?.fixture?.weather || null,
              xg: null, availability: null
            };
          }
        }
      } catch (e) {
        console.warn(`[evt:${partido?.id}] Error league±2d:`, e?.message || e);
      }
    }

    // === 3) BÚSQUEDA TEXTUAL
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
          // Fallback por cada equipo
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
            weather: best?.fixture?.weather || null,
            xg: null, availability: null
          };
        }
      }
    } catch (e) {
      console.warn(`[evt:${partido?.id}] Error search:`, e?.message || e);
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
    try { console.info("[OAI] meta=", JSON.stringify(meta)); } catch {}

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
      } catch {}
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
  const motivLine = motiv && motiv.toLowerCase() !== 's/d' ? `\n💬 “${motiv}”\n` : '\n';

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
            else { resumen.guardados_ok++; }
          } catch (e3) {
            console.error('Supabase insert (retry) exception:', e3?.message || e3);
            resumen.guardados_fail++;
          }
        } else {
          resumen.guardados_fail++;
        }
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

  const fixerModel = (String(model||'').toLowerCase().includes('gpt-5')) ? 'gpt-5-mini' : model;
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
