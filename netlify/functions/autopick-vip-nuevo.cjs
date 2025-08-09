// netlify/functions/autopick-vip-nuevo.cjs
// Patch v3.0 — Modelo 5 + fallback, ventana 45–55 (con amortiguador 35–65), guardianes, top-3 único,
// memoria IA filtrada, troceo Telegram, timeouts y backoff afinados.

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

// ===================== ENV =====================
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  OPENAI_MODEL // opcional
} = process.env;

function assertEnv() {
  const required = [
    'SUPABASE_URL','SUPABASE_KEY',
    'OPENAI_API_KEY',
    'TELEGRAM_BOT_TOKEN','TELEGRAM_CHANNEL_ID','TELEGRAM_GROUP_ID',
    'ODDS_API_KEY'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ ENV faltantes:', missing.join(', '));
    throw new Error('Variables de entorno faltantes');
  }
}

// ===================== CLIENTES =====================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// Modelo principal y fallback (Netlify env → fallback seguro)
const MODEL = (process.env.OPENAI_MODEL || OPENAI_MODEL || 'gpt-5-mini');
const MODEL_FALLBACK = (process.env.OPENAI_MODEL_FALLBACK || 'gpt-5');

// ===================== CONFIG =====================
const WINDOW_MIN = 45; // minutos
const WINDOW_MAX = 55; // minutos

const K_MIN = 3;       // cap mínimo por ciclo
const K_MAX = 6;       // cap máximo por ciclo
const CONCURRENCY = 3; // cuántos partidos "caros" en paralelo

const REQUEST_TIMEOUT_MS = 12000;
const RETRIES = 2;
const BACKOFF_MS = 600;

// ===================== UTILS =====================
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
        const body = await safeText(res);
        console.warn('fetchWithRetry status:', res.status, body?.slice(0,300));
        if (i === retries) return res;
      } else {
        return res;
      }
    } catch (e) {
      console.warn('fetchWithRetry error:', e?.message || e);
      if (i === retries) throw e;
    }
    await sleep(backoff * (i+1));
  }
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}
async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function includesLoose(a, b) {
  if (!a || !b) return false;
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  return na.includes(nb) || nb.includes(na);
}
function normalizeStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ===================== RESUMEN GLOBAL =====================
const globalResumen = {
  encontrados: 0, candidatos: 0, procesados: 0,
  descartados_ev: 0,
  intentos_vip: 0, intentos_free: 0,
  enviados_vip: 0, enviados_free: 0,
  guardados_ok: 0, guardados_fail: 0
};

// ===================== HANDLER =====================
exports.handler = async function () {
  try {
    assertEnv();

    const partidos = await obtenerPartidosDesdeOddsAPI();
    if (!Array.isArray(partidos) || partidos.length === 0) {
      console.log('OddsAPI: sin partidos en ventana');
      return { statusCode: 200, body: JSON.stringify({ mensaje: 'Sin partidos en ventana' }) };
    }

    const ordenados = partidos.sort((a, b) => a.timestamp - b.timestamp);
    const K = Math.max(K_MIN, Math.min(K_MAX, ordenados.length));
    const candidatos = ordenados.slice(0, K);

    globalResumen.candidatos = candidatos.length;

    const chunks = chunkArray(candidatos, CONCURRENCY);
    for (const grupo of chunks) {
      const tasks = grupo.map(partido => procesarPartido(partido));
      await Promise.allSettled(tasks);
    }

    console.log('Resumen ciclo:', JSON.stringify(globalResumen));
    return { statusCode: 200, body: JSON.stringify({ mensaje: 'Picks procesados correctamente', resumen: globalResumen }) };
  } catch (error) {
    console.error('❌ Error general en autopick-vip-nuevo:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};

// ===================== OBTENER PARTIDOS (OddsAPI) =====================
async function obtenerPartidosDesdeOddsAPI() {
  // Llamada simple (sin commenceTimeFrom/To). Filtramos localmente.
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=eu,us,uk` +
    `&markets=h2h,totals,spreads` +
    `&oddsFormat=decimal` +
    `&dateFormat=iso`;

  let res;
  try {
    res = await fetchWithRetry(url, {}, { retries: 1 });
  } catch (e) {
    console.error('❌ Error de red a OddsAPI:', e?.message || e);
    return [];
  }

  if (!res || !res.ok) {
    console.error('❌ OddsAPI no ok:', res?.status, await safeText(res));
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error('❌ JSON de OddsAPI inválido');
    return [];
  }
  if (!Array.isArray(data)) return [];

  const ahora = Date.now();
  const mapeados = data
    .map(evento => normalizeOddsEvent(evento, ahora))
    .filter(Boolean);

  // Ventana base
  const enVentana = [];
  const fueraVentana = [];
  for (const e of mapeados) {
    if (e.minutosFaltantes >= WINDOW_MIN && e.minutosFaltantes <= WINDOW_MAX) {
      enVentana.push(e);
    } else {
      fueraVentana.push({
        id: e.id,
        equipos: e.equipos,
        minutosFaltantes: Math.round(e.minutosFaltantes),
        motivo: e.minutosFaltantes < WINDOW_MIN ? 'muy_cercano' : 'muy_lejano',
        commence_iso: new Date(e.timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z')
      });
    }
  }

  // 🔍 Depuración: muestra 3 partidos con su minuto calculado
  for (const e of mapeados.slice(0, 3)) {
    console.log('DBG commence_time=', new Date(e.timestamp).toISOString(), 'mins=', Math.round(e.minutosFaltantes));
  }

  // Fallback temporal si no hay nada en 45–55
  if (enVentana.length === 0) {
    for (const e of mapeados) {
      const m = e.minutosFaltantes;
      if (m >= 35 && m <= 65) {
        enVentana.push(e);
      }
    }
    if (enVentana.length) {
      console.log('⚠️ Ventana ampliada 35–65 solo este ciclo:', enVentana.length);
    }
  }

  console.log(`OddsAPI: recibidos=${data.length}, en_ventana=${enVentana.length} (${WINDOW_MIN}–${WINDOW_MAX}m)`);
  globalResumen.encontrados = data.length;
  return enVentana;
}

function arrBest(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.reduce((max, o) => (o?.price > (max?.price || 0) ? o : max), null);
}

function normalizeOddsEvent(evento, ahoraTs) {
  try {
    const inicio = new Date(evento.commence_time).getTime();
    const minutosFaltantes = (inicio - ahoraTs) / 60000;

    // Recolecta outcomes por mercado y bookie para poder sacar top-3
    const marketsOutcomes = { h2h: [], totals_over: [], totals_under: [], spreads: [] };

    const marketsRaw = evento.bookmakers || [];
    for (const bk of marketsRaw) {
      const bookie = bk?.title || bk?.key || 'Desconocida';
      const ms = bk?.markets || [];
      for (const m of ms) {
        const key = m?.key; // 'h2h' | 'totals' | 'spreads'
        const outs = m?.outcomes || [];
        for (const o of outs) {
          const name = (o?.name || '').toLowerCase();
          const item = {
            bookie,
            name: o?.name || '',
            price: Number(o?.price),
            point: typeof o?.point !== 'undefined' ? o.point : null
          };
          if (key === 'h2h') {
            marketsOutcomes.h2h.push(item);
          } else if (key === 'totals') {
            if (/over/.test(name)) marketsOutcomes.totals_over.push(item);
            else if (/under/.test(name)) marketsOutcomes.totals_under.push(item);
          } else if (key === 'spreads') {
            marketsOutcomes.spreads.push(item);
          }
        }
      }
    }

    // Mejor global
    const mejorOutcome = Object.values(marketsOutcomes)
      .flat()
      .reduce((max, o) => (o?.price > (max?.price || 0) ? o : max), null);

    // Mejores por mercado (simple)
    const bestH2H = arrBest(marketsOutcomes.h2h);
    const bestTotalsOver = arrBest(marketsOutcomes.totals_over);
    const bestTotalsUnder = arrBest(marketsOutcomes.totals_under);
    const bestSpreads = arrBest(marketsOutcomes.spreads);

    return {
      id: evento.id,
      equipos: `${evento.home_team} vs ${evento.away_team}`,
      home: evento.home_team,
      away: evento.away_team,
      timestamp: inicio,
      minutosFaltantes,
      mejorCuota: (mejorOutcome ? { valor: Number(mejorOutcome.price), casa: mejorOutcome.bookie } : null),
      marketsBest: {
        h2h: bestH2H ? { valor: Number(bestH2H.price), label: bestH2H.name } : null,
        totals: {
          over: bestTotalsOver ? { valor: Number(bestTotalsOver.price), point: bestTotalsOver.point } : null,
          under: bestTotalsUnder ? { valor: Number(bestTotalsUnder.price), point: bestTotalsUnder.point } : null
        },
        spreads: bestSpreads ? { valor: Number(bestSpreads.price), label: bestSpreads.name, point: bestSpreads.point } : null
      },
      marketsOffers: {
        h2h: marketsOutcomes.h2h,
        totals_over: marketsOutcomes.totals_over,
        totals_under: marketsOutcomes.totals_under,
        spreads: marketsOutcomes.spreads,
      }
    };
  } catch (e) {
    console.error('normalizeOddsEvent error:', e?.message || e);
    return null;
  }
}

// ===================== ENRIQUECER (API-FOOTBALL) =====================
async function enriquecerPartidoConAPIFootball(partido) {
  if (!API_FOOTBALL_KEY) return null;

  const q = `${partido.home} ${partido.away}`;
  const url = `https://v3.football.api-sports.io/fixtures?search=${encodeURIComponent(q)}`;

  let res;
  try {
    res = await fetchWithRetry(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
  } catch (e) {
    console.error(`[evt:${partido.id}] Error de red Football:`, e?.message || e);
    return null;
  }

  if (!res || !res.ok) {
    console.error(`[evt:${partido.id}] Football no ok:`, res?.status, await safeText(res));
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`[evt:${partido.id}] JSON Football inválido`);
    return null;
  }

  const list = Array.isArray(data?.response) ? data.response : [];
  if (list.length === 0) return null;

  const targetTs = partido.timestamp;
  let best = null;
  let bestDiff = Infinity;

  for (const it of list) {
    const thome = it?.teams?.home?.name || '';
    const taway = it?.teams?.away?.name || '';
    const ts = it?.fixture?.date ? new Date(it.fixture.date).getTime() : null;
    if (!ts) continue;

    const diff = Math.abs(ts - targetTs);
    const namesOk = includesLoose(thome, partido.home) && includesLoose(taway, partido.away);
    if (namesOk && diff < bestDiff && diff <= 24 * 3600 * 1000) {
      best = it;
      bestDiff = diff;
    }
  }

  if (!best) return null;

  const liga =
    best?.league
      ? `${best.league?.country || ''}${best.league?.country ? ' - ' : ''}${best.league?.name || ''}`.trim()
      : null;

  return {
    liga: liga || partido.liga || null,
    fixture_id: best?.fixture?.id || null,
  };
}

// ===================== MEMORIA =====================
async function obtenerMemoriaSimilar(partido) {
  try {
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('evento, analisis, apuesta, equipos, ev, liga, timestamp')
      .order('timestamp', { ascending: false })
      .limit(30);

    if (error) {
      console.error('Supabase memoria error:', error.message);
      return [];
    }
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

// ===================== OPENAI PROMPT =====================
function construirPrompt(partido, info, memoria) {
  const datosClave = {
    liga: partido?.liga || 'No especificada',
    equipos: `${partido.home} vs ${partido.away}`,
    hora_estimada: 'Comienza en menos de 1 hora',
    cuota_maxima: partido?.mejorCuota?.valor || null,
    bookie: partido?.mejorCuota?.casa || null,
    markets_disponibles: Object.keys(partido?.marketsBest || {}).filter(k => partido?.marketsBest?.[k]),
  };

  return `
Eres un analista deportivo profesional. Devuelve SOLO JSON válido con estas claves:
- analisis_gratuito (máx 5-6 oraciones, conciso y claro)
- analisis_vip (máx 5-6 oraciones, táctico y con argumentos de datos)
- apuesta (ej.: "Más de 2.5 goles", "Menos de 2.5 goles", "1X2 local/visitante", "Hándicap", etc.)
- apuestas_extra (texto breve con 1-3 ideas extra si hay señales)
- frase_motivacional (1 línea, sin emojis)
- probabilidad (número decimal ENTRE 0.05 y 0.85; representa la prob. de acierto de la apuesta principal; ej: 0.62)

No inventes datos no proporcionados. Si faltan datos críticos, sé conservador.

Datos_clave:
${JSON.stringify(datosClave)}

Memoria_relevante:
${JSON.stringify((memoria || []).slice(0,3))}
`.trim();
}

// ===================== EV & PROBABILIDAD =====================
function estimarlaProbabilidadPct(pick, cuota) {
  let pct = null;
  if (pick && typeof pick.probabilidad !== 'undefined') {
    const v = Number(pick.probabilidad);
    if (!Number.isNaN(v)) {
      pct = (v > 0 && v < 1) ? (v * 100) : v;
    }
  }
  if (!pct) {
    const c = Number(cuota);
    if (c > 1.01) pct = Math.round(100 / c);
  }
  pct = Number(pct || 55);
  const p = Math.max(5, Math.min(85, Math.round(pct)));
  return p;
}
function calcularEV(probabilidadPct, cuota) {
  const p = Number(probabilidadPct) / 100;
  const c = Number(cuota);
  if (!p || !c) return null;
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
  const offers = partido?.marketsOffers || {};
  let arr = [];

  if (info.market === 'totals') {
    arr = (info.side === 'over') ? (offers.totals_over || []) : (offers.totals_under || []);
  } else if (info.market === 'spreads') {
    arr = offers.spreads || [];
  } else {
    arr = offers.h2h || [];
  }

  const seen = new Set();
  const top = [...arr]
    .filter(o => Number.isFinite(o.price))
    .sort((a, b) => b.price - a.price)
    .filter(o => {
      const key = (o.bookie || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map(o => ({
      bookie: o.bookie || 'N/D',
      price: Number(o.price),
      point: typeof o.point !== 'undefined' && o.point !== null ? o.point : null
    }));

  return top;
}

function seleccionarCuotaSegunApuesta(partido, apuesta) {
  const text = String(apuesta || '').toLowerCase();
  const m = partido?.marketsBest || {};
  let selected = null;

  if (text.includes('más de') || text.includes('over') || text.includes('total')) {
    if (m.totals && m.totals.over) selected = { valor: m.totals.over.valor, label: 'over', point: m.totals.over.point };
    else if (m.totals && m.totals.under) selected = { valor: m.totals.under.valor, label: 'under', point: m.totals.under.point };
  } else if (text.includes('menos de') || text.includes('under')) {
    if (m.totals && m.totals.under) selected = { valor: m.totals.under.valor, label: 'under', point: m.totals.under.point };
    else if (m.totals && m.totals.over) selected = { valor: m.totals.over.valor, label: 'over', point: m.totals.over.point };
  } else if (text.includes('hándicap') || text.includes('handicap') || text.includes('spread')) {
    if (m.spreads) selected = { valor: m.spreads.valor, label: m.spreads.label, point: m.spreads.point };
  } else {
    if (m.h2h) selected = { valor: m.h2h.valor, label: m.h2h.label };
  }

  if (!selected && partido?.mejorCuota?.valor) selected = partido.mejorCuota;

  const top3 = top3ForSelectedMarket(partido, apuesta);
  return { ...selected, top3 };
}

// ===================== MENSAJES =====================
function construirMensajeVIP(partido, pick, probabilidadPct, ev, nivel, cuotaInfo) {
  const top3Text = (Array.isArray(cuotaInfo?.top3) ? cuotaInfo.top3 : [])
    .slice(0,3)
    .map((b, i) => `${i+1}️⃣ ${b?.bookie || '—'}: ${Number(b?.price || 0).toFixed(2)}`)
    .join('\n');

  const badge = nivel;
  const cuotaTxt = `${Number(cuotaInfo.valor).toFixed(2)} (${cuotaInfo.label || '—'})`;

  return `
🎯 PICK NIVEL: ${badge}
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.home} vs ${partido.away}
🕒 Comienza en menos de 1 hora

📊 Cuota: ${cuotaTxt}
📈 Probabilidad estimada: ${Math.round(probabilidadPct)}%
💰 Valor esperado: ${ev}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra || 'N/A'}${top3Text ? `

📊 Ranking en vivo de cuotas para este partido:
${top3Text}` : ''}

📌 Datos avanzados:
${pick.analisis_vip}

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

function construirMensajeFree(partido, pick) {
  return `
📡 RADAR DE VALOR
🏆 ${partido.liga || 'No especificada'}
📅 ${partido.home} vs ${partido.away}
🕒 Comienza en menos de 1 hora

${pick.analisis_gratuito}

💬 ${pick.frase_motivacional}

🎁 ¡Únete 15 días gratis al grupo VIP!
@punterxpicks

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

// ===================== TELEGRAM =====================
async function enviarMensajeTelegram(texto, tipo) {
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const MAX_TELEGRAM = 4096;
  const chunks = [];
  let t = String(texto || '');
  while (t.length > MAX_TELEGRAM) {
    chunks.push(t.slice(0, MAX_TELEGRAM));
    t = t.slice(MAX_TELEGRAM);
  }
  if (t) chunks.push(t);

  if (chunks.length > 1) {
    for (let i = 0; i < chunks.length; i++) {
      try {
        const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunks[i] })
        }, { retries: 1 });
        if (!res || !res.ok) {
          const body = res ? await safeText(res) : '';
          console.error('❌ Error Telegram (chunk)', i+1, res?.status, body);
          return false;
        }
      } catch (e) {
        console.error('❌ Error de red Telegram (chunk)', i+1, e?.message || e);
        return false;
      }
    }
    return true;
  }

  try {
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto })
    }, { retries: 1 });

    if (!res || !res.ok) {
      const body = res ? await safeText(res) : '';
      console.error('❌ Error Telegram:', res?.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('❌ Error de red Telegram:', e?.message || e);
    return false;
  }
}

// ===================== SUPABASE =====================
async function guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidadPct, ev) {
  try {
    // Blindaje: probabilidad 0–100 entero
    const safeProb = Math.max(0, Math.min(100, Math.round(Number(probabilidadPct) || 0)));

    const payload = {
      evento: partido.id,
      analisis: pick.analisis_vip,
      apuesta: pick.apuesta,
      // Cumple la CHECK de la BD (VIP/GRATUITO)
      tipo_pick: String(tipo_pick).toUpperCase(),
      liga: partido.liga || 'No especificada',
      equipos: `${partido.home} vs ${partido.away}`,
      ev,
      probabilidad: safeProb,
      nivel
    };

    const { error, status } = await supabase
      .from('picks_historicos')
      .insert([payload]);

    if (error) {
      if (String(error.message || '').includes('duplicate key') || status === 409) {
        console.warn('Duplicado detectado (UNIQUE evento), no reenviamos.');
        return true; // idempotente
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

// ===================== VALIDACIÓN PICK =====================
function validatePick(pick) {
  if (!pick) return false;
  if (!pick.analisis_vip || !pick.analisis_gratuito) return false;
  if (!pick.apuesta) return false;
  return true;
}

// ---------- Helpers de modelo / validación ----------
function pickCompleto(pick) {
  return !!(
    pick &&
    typeof pick.analisis_vip === 'string' &&
    typeof pick.analisis_gratuito === 'string' &&
    typeof pick.apuesta === 'string' &&
    pick.analisis_vip.trim() &&
    pick.analisis_gratuito.trim() &&
    pick.apuesta.trim()
  );
}

async function pedirPickConModelo(modelo, prompt) {
  const completion = await openai.createChatCompletion({
    model: modelo,
    messages: [{ role: 'user', content: prompt }],
  });
  const respuesta = completion?.data?.choices?.[0]?.message?.content;
  if (!respuesta || typeof respuesta !== 'string') return null;
  try {
    return JSON.parse(respuesta);
  } catch (e) {
    console.error('JSON inválido de GPT:', respuesta.slice(0, 300));
    return null;
  }
}

async function obtenerPickConFallback(prompt) {
  let modeloUsado = MODEL;
  let pick = await pedirPickConModelo(MODEL, prompt);
  if (!pickCompleto(pick)) {
    console.log('♻️ Fallback de modelo →', MODEL_FALLBACK);
    modeloUsado = MODEL_FALLBACK;
    pick = await pedirPickConModelo(MODEL_FALLBACK, prompt);
  }
  return { pick, modeloUsado };
}

function impliedProbPct(cuota) {
  if (!cuota || isNaN(cuota)) return null;
  return Math.round(100 / Number(cuota));
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

// ===================== PROCESAR PARTIDO =====================
async function procesarPartido(partido) {
  const traceId = `[evt:${partido.id}]`;
  try {
    // Enriquecimiento + memoria en paralelo (no bloquean si fallan)
    const [enriqRes, memRes] = await Promise.allSettled([
      enriquecerPartidoConAPIFootball(partido),
      obtenerMemoriaSimilar(partido)
    ]);

    const enriquecido = (enriqRes.status === 'fulfilled' && enriqRes.value) ? enriqRes.value : null;
    const memoria = (memRes.status === 'fulfilled' && Array.isArray(memRes.value)) ? memRes.value : [];

    const P = { ...partido, ...(enriquecido || {}) };

    const prompt = construirPrompt(P, enriquecido || {}, memoria);

    // ---------- Liga/País guard ----------
    if (!P.liga || /desconocida|no especificada/i.test(P.liga)) {
      console.warn(traceId, '❌ Liga/país no disponible → descartando');
      return;
    }

    // ---------- OpenAI ----------
    let pick;
    let modeloUsado = MODEL;
    try {
      const r = await obtenerPickConFallback(prompt);
      pick = r.pick;
      modeloUsado = r.modeloUsado;
      console.log(traceId, '🔎 Modelo usado:', modeloUsado);

      if (!validatePick(pick)) {
        console.warn(traceId, 'Pick incompleto tras fallback', pick);
        return;
      }
    } catch (error) {
      console.error(traceId, 'Error GPT:', error?.message || error);
      return;
    }

    // ---------- Cuota coherente con la apuesta ----------
    const cuotaSel = seleccionarCuotaSegunApuesta(P, pick.apuesta);
    if (!cuotaSel || !cuotaSel.valor) {
      console.warn(traceId, 'No se encontró cuota coherente con la apuesta; uso mejorCuota global');
    }
    const cuota = (cuotaSel && cuotaSel.valor) ? cuotaSel.valor : P?.mejorCuota?.valor;

    // ---------- Consistencia apuesta/outcome ----------
    const outcomeTxt = (cuotaSel && cuotaSel.label) ? String(cuotaSel.label) : String(P?.marketsBest?.h2h?.label || '');
    const homeTeam = P?.home;
    const awayTeam = P?.away;
    if (!apuestaCoincideConOutcome(pick.apuesta, outcomeTxt, homeTeam, awayTeam)) {
      console.warn(traceId, '❌ Inconsistencia apuesta/outcome → descartando', { apuesta: pick.apuesta, outcomeTxt, homeTeam, awayTeam });
      return;
    }

    // ---------- Prob & EV ----------
    const probPct = estimarlaProbabilidadPct(pick, cuota);
    const imp = impliedProbPct(cuota);
    if (imp != null && probPct != null && (probPct - imp) > 25) {
      console.warn(traceId, `❌ Probabilidad inconsistente con cuota (prob=${probPct}%, implícita=${imp}%) → descartando pick`);
      return;
    }
    const ev = calcularEV(probPct, cuota);
    if (ev == null) { console.warn(traceId, 'EV nulo'); return; }

    globalResumen.procesados++;

    if (ev < 10) { globalResumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); return; }

    const nivel = clasificarPickPorEV(ev);
    const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';

    if (tipo_pick === 'vip') globalResumen.intentos_vip++;
    else globalResumen.intentos_free++;

    // ---------- Mensaje (con top-3) ----------
    const cuotaInfo = {
      valor: Number(cuota).toFixed(2),
      label: (cuotaSel?.label || P?.mejorCuota?.casa || 'N/D'),
      top3: cuotaSel?.top3 || []
    };

    const mensaje = tipo_pick === 'vip'
      ? construirMensajeVIP(P, pick, probPct, ev, nivel, cuotaInfo)
      : construirMensajeFree(P, pick);

    // ---------- Supabase primero (claim) ----------
    if (!P.liga || !pick?.apuesta || !pick?.analisis_vip || !pick?.analisis_gratuito) {
      console.warn(traceId, 'Datos incompletos → no guardar/enviar.');
      return;
    }

    const okSave = await guardarEnSupabase(P, pick, tipo_pick, nivel, probPct, ev);
    if (!okSave) {
      globalResumen.guardados_fail++;
      console.error(traceId, 'No soy el dueño (duplicado) o fallo al guardar → NO envío');
      return;
    }
    globalResumen.guardados_ok++;

    // ---------- Telegram (solo si guardé yo) ----------
    const okTelegram = await enviarMensajeTelegram(mensaje, tipo_pick);
    if (okTelegram) {
      if (tipo_pick === 'vip') globalResumen.enviados_vip++;
      else globalResumen.enviados_free++;
    } else {
      console.error(traceId, 'Fallo Telegram (no bloquea)');
    }
  } catch (e) {
    console.error(traceId, 'Excepción procesando partido:', e?.message || e);
  }
}

// ===================== TOP-3 / FORMATEO =====================
function top3ForText(top3) {
  if (!Array.isArray(top3) || !top3.length) return '';
  const lines = top3.slice(0,3).map((b,i) => `${i+1}️⃣ ${b?.bookie || '—'}: ${Number(b?.price || 0).toFixed(2)}`);
  return `${lines.join('\n')}`;
}
