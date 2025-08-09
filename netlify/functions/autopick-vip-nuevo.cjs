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
  OPENAI_MODEL
} = process.env;

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY',
    'OPENAI_API_KEY',
    'TELEGRAM_BOT_TOKEN','TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID',
    'ODDS_API_KEY','API_FOOTBALL_KEY'
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
const WINDOW_MIN       = Number(process.env.WINDOW_MIN || 45);
const WINDOW_MAX       = Number(process.env.WINDOW_MAX || 60);
const WINDOW_FB_MIN    = Number(process.env.WINDOW_FALLBACK_MIN || 35);
const WINDOW_FB_MAX    = Number(process.env.WINDOW_FALLBACK_MAX || 70);

// Log de configuración de ventanas
console.log(`⚙️ Config ventana principal: ${WINDOW_MIN}–${WINDOW_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);

// Función para log de filtrado
function logFiltradoPartidos(partidos, etiqueta) {
    const enVentana = partidos.filter(p => p.enVentanaPrincipal).length;
    const enFallback = partidos.filter(p => p.enVentanaFallback).length;
    console.log(`📊 Filtrado (${etiqueta}): Principal=${enVentana} | Fallback=${enFallback} | Total recibidos=${partidos.length}`);

const CONCURRENCY      = Number(process.env.CONCURRENCY || 6);
const CYCLE_SOFT_BUDGET_MS = Number(process.env.CYCLE_SOFT_BUDGET_MS || 70000);
const MAX_OAI_CALLS_PER_CYCLE = Number(process.env.MAX_OAI_CALLS_PER_CYCLE || 0); // 0 = sin tope

// Prefiltro (prioriza sin descartar)
const PREFILTER_MIN_BOOKIES   = Number(process.env.PREFILTER_MIN_BOOKIES || 4);
const PREFILTER_MIN_EDGE_PCT  = Number(process.env.PREFILTER_MIN_EDGE_PCT || 3);   // mejor vs mediana
const PREFILTER_MIN_PRICE     = Number(process.env.PREFILTER_MIN_PRICE || 1.50);
const PREFILTER_MAX_PRICE     = Number(process.env.PREFILTER_MAX_PRICE || 6.00);
const PREFILTER_RECENCY_MIN   = Number(process.env.PREFILTER_RECENCY_MIN || 15);   // minutos

const REQUEST_TIMEOUT_MS = 12000;
const RETRIES = 2;
const BACKOFF_MS = 600;

// =============== UTILS ===============
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = cfg.retries ?? RETRIES;
  const backoff = cfg.backoff ?? BACKOFF_MS;
  const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;

  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        if (i === retries) return res;
      } else {
        return res;
      }
    } catch (e) {
      if (i === retries) throw e;
    }
    await sleep(backoff * (i+1));
  }
}

async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeStr(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function includesLoose(a, b) {
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  return !!na && !!nb && (na.includes(nb) || nb.includes(na));
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
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
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
    const partidos = await obtenerPartidosDesdeOddsAPI();
    if (!Array.isArray(partidos) || partidos.length === 0) {
      console.log('OddsAPI: sin partidos en ventana');
      return ok({ mensaje: 'Sin partidos en ventana' });
    }

    // Orden por score preliminar (desc) y por kickoff (asc) como tie-break
    partidos.sort((a,b) => (b.prefScore - a.prefScore) || (a.timestamp - b.timestamp));
    resumen.candidatos = partidos.length;

    const chunks = chunkArray(partidos, CONCURRENCY);
    for (const grupo of chunks) {
      // Soft budget / tope OAI por ciclo
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
        if (resumen.procesados > prev) resumen.oai_calls++;
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
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${ODDS_API_KEY}&regions=eu,us,uk&markets=h2h,totals,spreads&oddsFormat=decimal&dateFormat=iso`;

  let res;
  try { res = await fetchWithRetry(url, {}, { retries: 1 }); }
  catch (e) { console.error('❌ Error red OddsAPI:', e?.message || e); return []; }

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

  // Ventana base
  let enVentana = mapeados.filter(e => e.minutosFaltantes >= WINDOW_MIN && e.minutosFaltantes <= WINDOW_MAX);

  // Fallback solo si base queda vacía
  if (enVentana.length === 0) {
    enVentana = mapeados.filter(e => e.minutosFaltantes >= WINDOW_FB_MIN && e.minutosFaltantes <= WINDOW_FB_MAX);
    if (enVentana.length) {
      console.log(`⚠️ Ventana ampliada ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} solo este ciclo:`, enVentana.length);
    }
  }

  // Hard stop: nunca < 35 min
  enVentana = enVentana.filter(e => e.minutosFaltantes >= 35);

  // 📊 Log filtrado detallado
logFiltradoPartidos(data, "OddsAPI");

  resumen.enVentana = enVentana.length;
  console.log(`OddsAPI: recibidos=${data.length}, en_ventana=${enVentana.length} (${WINDOW_MIN}–${WINDOW_MAX}m)`);

  // Prefiltro: score preliminar (no descarta, solo ordena)
  for (const p of enVentana) {
    p.prefScore = scorePreliminar(p);
  }

  return enVentana;
}

function normalizeOddsEvent(evento, ahoraTs) {
  try {
    const inicioIso = evento.commence_time;
    const ts = Date.parse(inicioIso);
    const mins = (ts - ahoraTs) / 60000;

    const home = evento.home_team;
    const away = evento.away_team;

    const marketsOutcomes = { h2h: [], totals_over: [], totals_under: [], spreads: [] };
    const allPrices = [];
    let anyRecentMin = null;

    const bks = Array.isArray(evento.bookmakers) ? evento.bookmakers : [];
    for (const bk of bks) {
      const bookie = bk?.title || bk?.key || 'N/D';
      const lastUpd = bk?.last_update ? Date.parse(bk.last_update) : null; // algunos endpoints lo traen
      if (lastUpd) {
        const minsAgo = Math.max(0, Math.round((Date.now() - lastUpd) / 60000));
        if (anyRecentMin == null || minsAgo < anyRecentMin) anyRecentMin = minsAgo;
      }
      const ms = Array.isArray(bk?.markets) ? bk.markets : [];
      for (const m of ms) {
        const key = m?.key;
        const outs = Array.isArray(m?.outcomes) ? m.outcomes : [];
        for (const o of outs) {
          const name = o?.name || '';
          const price = Number(o?.price);
          const point = typeof o?.point !== 'undefined' ? o.point : null;
          if (Number.isFinite(price)) allPrices.push(price);

          const item = { bookie, name, price, point };
          if (key === 'h2h') {
            marketsOutcomes.h2h.push(item);
          } else if (key === 'totals') {
            const ln = name.toLowerCase();
            if (ln.includes('over')) marketsOutcomes.totals_over.push(item);
            else if (ln.includes('under')) marketsOutcomes.totals_under.push(item);
          } else if (key === 'spreads') {
            marketsOutcomes.spreads.push(item);
          }
        }
      }
    }

    const bestAny = allPrices.length ? Math.max(...allPrices) : null;
    const medAny  = median(allPrices);
    const bestH2H = arrBest(marketsOutcomes.h2h);
    const bestTotOver = arrBest(marketsOutcomes.totals_over);
    const bestTotUnder = arrBest(marketsOutcomes.totals_under);
    const bestSpread   = arrBest(marketsOutcomes.spreads);

    return {
      id: evento.id,
      equipos: `${home} vs ${away}`,
      home, away,
      timestamp: ts,
      minutosFaltantes: mins,
      mejorCuota: bestAny ? { valor: bestAny } : null,
      marketsBest: {
        h2h:   bestH2H ?   { valor: bestH2H.price, label: bestH2H.name } : null,
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
  const hasTotals = (p.marketsOffers?.totals_over||[]).length > 0 || (p.marketsOffers?.totals_under||[]).length > 0;
  if (hasH2H && hasTotals) score += 20;

  // Edge preliminar (mejor vs mediana)
  const all = [
    ...(p.marketsOffers?.h2h||[]),
    ...(p.marketsOffers?.totals_over||[]),
    ...(p.marketsOffers?.totals_under||[]),
    ...(p.marketsOffers?.spreads||[])
  ].map(x => Number(x?.price)).filter(n => Number.isFinite(n));
  const med = median(all);
  const best = p?.mejorCuota?.valor || null;
  if (med && best) {
    const edgePct = ((best / med) - 1) * 100;
    if (edgePct >= PREFILTER_MIN_EDGE_PCT) score += 25;
  }

  // Rango de cuota útil
  const anyPrice = best || med || null;
  if (anyPrice && anyPrice >= PREFILTER_MIN_PRICE && anyPrice <= PREFILTER_MAX_PRICE) score += 20;

  // Recencia
  if (typeof p.recentMins === 'number' && p.recentMins <= PREFILTER_RECENCY_MIN) score += 15;

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
  if (!list.length) return null;

// Log de filtrado API-Football
logFiltradoPartidos(list, "API-FOOTBALL");
  
  const targetTs = partido.timestamp;
  let best = null, bestDiff = Infinity;

  for (const it of list) {
    const thome = it?.teams?.home?.name || '';
    const taway = it?.teams?.away?.name || '';
    const ts = it?.fixture?.date ? Date.parse(it.fixture.date) : null;
    if (!ts) continue;
    const namesOk = includesLoose(thome, partido.home) && includesLoose(taway, partido.away);
    const diff = Math.abs(ts - targetTs);
    if (namesOk && diff < bestDiff && diff <= 24*3600*1000) {
      best = it; bestDiff = diff;
    }
  }
  if (!best) return null;

  const country = best?.league?.country || null;
  const lname   = best?.league?.name || null;

  return {
    liga: (country && lname) ? `${country} — ${lname}` : null,
    fixture_id: best?.fixture?.id || null
  };
}

// =============== LIGA (resolver) ===============
function parseLigaPaisFromSportTitle(st) {
  if (!st) return null;
  const dash = st.split('-').map(s => s.trim());
  if (dash.length >= 2) {
    const country = dash[0]; const name = dash.slice(1).join(' - ');
    if (country && name) return `${country} — ${name}`;
  }
  const colon = st.split(':').map(s => s.trim());
  if (colon.length >= 2) {
    const country = colon[0]; const name = colon.slice(1).join(': ');
    if (country && name) return `${country} — ${name}`;
  }
  return st;
}

function resolverLigaPais(P) {
  if (P?.liga) return P.liga;
  const parsed = parseLigaPaisFromSportTitle(P?.sport_title);
  return parsed || null;
}

// =============== MEMORIA IA ===============
async function obtenerMemoriaSimilar(partido) {
  try {
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('evento, analisis, apuesta, equipos, ev, liga, timestamp')
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
async function pedirPickConModelo(modelo, prompt) {
  const completion = await openai.createChatCompletion({
    model: modelo,
    messages: [{ role: 'user', content: prompt }],
  });
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
  try {
    return await pedirPickConModelo(modelo, prompt);
  } catch (e) {
    console.warn('OpenAI fallo, reintento 1:', e?.message || e);
    await sleep(500);
    try { return await pedirPickConModelo(modelo, prompt); }
    catch { return null; }
  }
}

async function obtenerPickConFallback(prompt) {
  let modeloUsado = MODEL;
  let pick = await pedirPickConRetry(MODEL, prompt);
  if (!pickCompleto(pick)) {
    console.log('♻️ Fallback de modelo →', MODEL_FALLBACK);
    modeloUsado = MODEL_FALLBACK;
    pick = await pedirPickConRetry(MODEL_FALLBACK, prompt);
  }
  return { pick, modeloUsado };
}

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
- analisis_gratuito (máx 5–6 frases)
- analisis_vip (máx 5–6 frases)
- apuesta (ej.: "Más de 2.5 goles", "Menos de 2.5 goles", "1X2 local/visitante", "Hándicap", etc.)
- apuestas_extra (texto breve con 1–3 ideas)
- frase_motivacional (1 línea, sin emojis)
- probabilidad (número decimal ENTRE 0.05 y 0.85; ej: 0.60)

No inventes datos no proporcionados. Si faltan datos, sé conservador.

Datos_clave:
${JSON.stringify(datosClave)}

Memoria_relevante (máx 5):
${JSON.stringify((memoria || []).slice(0,5))}
`.trim();
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
  return Math.round(100 / c);
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
  const a = (apuestaTxt || '').toLowerCase();
  const o = (outcomeTxt || '').toLowerCase();
  const home = (homeTeam || '').toLowerCase();
  const away = (awayTeam || '').toLowerCase();

  const esLocal = a.includes('local') || a.includes('home') || a.includes('1');
  const esVisit = a.includes('visitante') || a.includes('away') || a.includes('2');
  const nombraHome = home && a.includes(home);
  const nombraAway = away && a.includes(away);

  if (nombraHome && !o.includes(home)) return false;
  if (nombraAway && !o.includes(away)) return false;
  if (esLocal && (o.includes(away) || o.includes('away'))) return false;
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

  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)}${cuotaInfo.point!=null?` (línea ${cuotaInfo.point})`:''}`;

  return `
🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${partido.liga}
📅 ${partido.home} vs ${partido.away}
🕒 ${formatMinAprox(mins)}

📊 Cuota: ${cuotaTxt}
📈 Probabilidad estimada: ${Math.round(probPct)}%
💰 Valor esperado: ${ev}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra || 'N/A'}${top3Text}

📌 Datos avanzados:
${pick.analisis_vip}

${TAGLINE}
⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

function construirMensajeFree(partido, pick) {
  const mins = Math.max(0, Math.round(partido.minutosFaltantes));
  return `
📡 RADAR DE VALOR
🏆 ${partido.liga}
📅 ${partido.home} vs ${partido.away}
🕒 ${formatMinAprox(mins)}

${pick.analisis_gratuito}

💬 ${pick.frase_motivacional}

${TAGLINE}
⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.

¡Únete 15 días gratis al grupo VIP!
@punterxpicks
`.trim();
}

// =============== TELEGRAM ===============
async function enviarMensajeTelegram(texto, tipo) {
  const chatId = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX_TELEGRAM = 4096;

  const sendOnce = async (payload) => {
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, { retries: 0, timeoutMs: 15000 });

    if (res && res.status === 429) {
      const body = await safeJson(res);
      const retryAfter = Number(body?.parameters?.retry_after || 0);
      if (retryAfter > 0 && retryAfter <= 10) {
        console.warn('Telegram 429, reintento en', retryAfter, 's');
        await sleep(retryAfter * 1000);
        return await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, { retries: 0, timeoutMs: 15000 });
      }
    }
    return res;
  };

  // Troceo
  let t = String(texto || '');
  const chunks = [];
  while (t.length > MAX_TELEGRAM) { chunks.push(t.slice(0, MAX_TELEGRAM)); t = t.slice(MAX_TELEGRAM); }
  if (t) chunks.push(t);

  for (let i = 0; i < chunks.length; i++) {
    const res = await sendOnce({ chat_id: chatId, text: chunks[i] });
    if (!res || !res.ok) {
      const body = res ? await safeText(res) : '';
      console.error('❌ Telegram error:', res?.status, body);
      return false;
    }
  }
  return true;
}

// =============== SUPABASE ===============
async function guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidadPct, ev) {
  try {
    const safeProb = Math.max(0, Math.min(100, Math.round(Number(probabilidadPct) || 0)));
    const payload = {
      evento: partido.id,
      analisis: pick.analisis_vip,
      apuesta: pick.apuesta,
      tipo_pick: String(tipo_pick).toUpperCase(), // VIP / GRATUITO
      liga: partido.liga,
      equipos: `${partido.home} vs ${partido.away}`,
      ev, probabilidad: safeProb, nivel
    };
    const { error, status } = await supabase.from('picks_historicos').insert([payload]);
    if (error) {
      if (String(error.message||'').includes('duplicate key') || status === 409) {
        console.warn('Duplicado detectado (UNIQUE evento), no reenviamos.');
        return true;
      }
      console.error('Supabase insert error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Supabase excepción insert:', e?.message || e);
    return false;
  }
}

// =============== PROCESAR PARTIDO ===============
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

    const prompt = construirPrompt(P, enr || {}, memoria);

    // OpenAI (fallback + 1 reintento en cada modelo)
    let pick, modeloUsado = MODEL;
    try {
      const r = await obtenerPickConFallback(prompt);
      pick = r.pick; modeloUsado = r.modeloUsado;
      console.log(traceId, '🔎 Modelo usado:', modeloUsado);
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

    const nivel = clasificarPickPorEV(ev);
    const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';
    if (tipo_pick === 'vip') resumen.intentos_vip++; else resumen.intentos_free++;

    // Mensajes
    const cuotaInfo = { valor: cuota, point: cuotaSel?.point ?? null, top3: cuotaSel?.top3 || [] };
    const mensaje = (tipo_pick === 'vip')
      ? construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo)
      : construirMensajeFree(P, pick);

    // Guardar (solo si tengo todo)
    if (!P.liga || !pick?.apuesta || !pick?.analisis_vip || !pick?.analisis_gratuito) {
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
