// netlify/functions/autopick-vip-nuevo.cjs
// Patch v2.1 — paralelismo, retries/backoff, filtro por tiempo en OddsAPI, top-3 bookies (VIP),
// upsert antes de enviar (evita duplicados), cuota coherente con la apuesta, logs extendidos.

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
const MODEL = OPENAI_MODEL || 'gpt-4';

// ===================== CONFIG =====================
const WINDOW_MIN = 35; // minutos
const WINDOW_MAX = 55; // minutos

const K_MIN = 3;       // cap mínimo por ciclo
const K_MAX = 6;       // cap máximo por ciclo
const CONCURRENCY = 3; // cuántos partidos "caros" en paralelo

const REQUEST_TIMEOUT_MS = 8000;
const RETRIES = 2;
const BACKOFF_MS = 600;

// ===================== UTILS =====================
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = cfg.retries ?? RETRIES;
  const backoff = cfg.backoffMs ?? BACKOFF_MS;
  const timeoutMs = cfg.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (!res.ok) {
        if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < retries) {
          const body = await safeText(res);
          console.warn(`⚠️ ${url} -> ${res.status} retry ${attempt + 1}/${retries}`, body);
          await delay(backoff * Math.pow(2, attempt));
          attempt++;
          continue;
        }
      }
      return res;
    } catch (e) {
      clearTimeout(id);
      lastErr = e;
      if (attempt < retries) {
        console.warn(`⚠️ Error de red en ${url} retry ${attempt + 1}/${retries}:`, e?.message || e);
        await delay(backoff * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      break;
    }
  }
  if (lastErr) throw lastErr;
  return null;
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
  encontrados: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
  intentos_vip: 0, intentos_free: 0, enviados_vip: 0, enviados_free: 0,
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
    res = await fetchWithRetry(url);
  } catch (e) {
    console.error('❌ Error de red al consultar OddsAPI:', e?.message || e);
    return [];
  }
  if (!res || !res.ok) {
    const body = res ? await safeText(res) : '';
    console.error('❌ Error al obtener datos de OddsAPI', res?.status, body);
    console.log('URL usada (sin filtros de tiempo):', url);
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

  console.log(`OddsAPI: recibidos=${data.length}, en_ventana=${enVentana.length} (${WINDOW_MIN}–${WINDOW_MAX}m)`);
  if (fueraVentana.length) {
    console.log('Fuera de ventana (ejemplos):', JSON.stringify(fueraVentana.slice(0, 6)));
  }
  globalResumen.encontrados = data.length;

  // Fallback adaptativo 30–60 solo si hay data pero nada en ventana base
  if (data.length > 0 && enVentana.length === 0) {
    const FALLBACK_MIN = 30;
    const FALLBACK_MAX = 60;
    const enFallback = mapeados.filter(e =>
      e.minutosFaltantes >= FALLBACK_MIN && e.minutosFaltantes <= FALLBACK_MAX
    );
    if (enFallback.length > 0) {
      console.log(`⚠️ Fallback activado: ${enFallback.length} partidos en ${FALLBACK_MIN}–${FALLBACK_MAX}m (ciclo actual)`);
      return enFallback;
    }
  }

  return enVentana;
}

// ===================== NORMALIZAR EVENTO =====================
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
      marketsOffers: marketsOutcomes // para top-3 por mercado
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

    const namesOk = includesLoose(thome, partido.home) && includesLoose(taway, partido.away);
    const diff = Math.abs(ts - targetTs);

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
      .select('evento, analisis, apuesta, equipos, ev')
      .order('timestamp', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Supabase memoria error:', error.message);
      return [];
    }
    return data || [];
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
  return pct || 0;
}
function clampProb(pct) {
  let p = Number(pct);
  if (!Number.isFinite(p)) p = 0;
  if (p < 5) p = 5;
  if (p > 85) p = 85;
  return Math.round(p);
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

// ===================== MERCADOS / TOP-3 =====================
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

  const top = [...arr]
    .filter(o => Number.isFinite(o.price))
    .sort((a, b) => b.price - a.price)
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
  const cuotaTxt = cuotaInfo?.valor || (Number(partido?.mejorCuota?.valor || 0).toFixed(2));
  const labelTxt = cuotaInfo?.label || partido?.mejorCuota?.casa || 'N/D';

  let top3Txt = '';
if (Array.isArray(cuotaInfo?.top3) && cuotaInfo.top3.length) {
  const idxEmoji = ['1️⃣','2️⃣','3️⃣'];
  const lines = cuotaInfo.top3.map((o, i) => {
    const pt = (typeof o.point === 'number' && !Number.isNaN(o.point)) ? ` @${o.point}` : '';
    return `${idxEmoji[i] || `#${i+1}`} ${o.bookie}: ${Number(o.price).toFixed(2)}${pt}`;
  });
  top3Txt = `\n📊 Ranking en vivo de cuotas para este partido:\n${lines.join('\n')}`;
}

  return `
🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.home} vs ${partido.away}
🕒 Comienza en menos de 1 hora

📊 Cuota: ${cuotaTxt} (${labelTxt})
📈 Probabilidad estimada: ${Math.round(probabilidadPct)}%
💰 Valor esperado: ${ev}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra || 'N/A'}${top3Txt}

📌 Datos avanzados:
${pick.analisis_vip}

⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.
`.trim();
}

function construirMensajeFree(partido, pick) {
  return `
📡 RADAR DE VALOR
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.home} vs ${partido.away}
🕒 Comienza en menos de 1 hora

📌 Análisis de los expertos:
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
      nivel,
      timestamp: new Date().toISOString()
    };

    // 1) Intentar INSERT a secas (requiere UNIQUE(evento) en la tabla)
    const { data, error } = await supabase
      .from('picks_historicos')
      .insert([payload])
      .select(); // en v2, para que devuelva filas

    if (error) {
      // Si es violación de UNIQUE (evento ya existe), NO somos dueños → no enviamos
      const msg = error.message || '';
      const code = error.code || '';
      if (code === '23505' || /duplicate key value/i.test(msg)) {
        // Ya existe ese evento; otro proceso/ciclo lo insertó
        return false;
      }
      console.error('Supabase insert error:', error.message);
      console.error('Payload rechazado por Supabase:', JSON.stringify(payload));
      return false;
    }

    // Si insertó, data tendrá 1 fila: somos dueños → enviamos
    const inserted = Array.isArray(data) && data.length > 0;
    return inserted;
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

    // ---------- OpenAI ----------
    let pick;
    try {
      const completion = await openai.createChatCompletion({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        // max_tokens: 400, // opcional
      });

      const respuesta = completion?.data?.choices?.[0]?.message?.content;
      if (!respuesta || typeof respuesta !== 'string') {
        console.error(traceId, 'Respuesta GPT vacía');
        return;
      }

      try {
        pick = JSON.parse(respuesta);
      } catch (e) {
        console.error(traceId, 'JSON inválido de GPT:', respuesta.slice(0, 300));
        return;
      }

      if (!validatePick(pick)) {
        console.warn(traceId, 'Pick incompleto', pick);
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

    // ---------- Prob & EV ----------
    const probPct = clampProb(estimarlaProbabilidadPct(pick, cuota));
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
