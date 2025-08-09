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
    throw new Error('Faltan variables de entorno: ' + missing.join(', '));
  }
}
assertEnv();

// ===================== CLIENTES =====================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// Modelo principal y fallback
const MODEL = (process.env.OPENAI_MODEL || OPENAI_MODEL || 'gpt-5-mini');
const MODEL_FALLBACK = (process.env.OPENAI_MODEL_FALLBACK || 'gpt-5');

// ===================== CONFIG =====================
const TIMEZONE = 'America/Mexico_City';
const WINDOW_MIN = 45; // minutos
const WINDOW_MAX = 55; // minutos
const MAX_PARTIDOS_POR_CICLO = 20;

const REQUEST_TIMEOUT_MS = 12000;
const RETRIES = 2;
const RETRY_BACKOFF_MS = 500;

// ===================== UTILS =====================
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(url, options = {}, cfg = {}) {
  const retries = cfg.retries ?? RETRIES;
  const backoff = cfg.backoff ?? RETRY_BACKOFF_MS;
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

function nowMx() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
}

function minutesUntil(dateIso) {
  const now = nowMx();
  const d = new Date(dateIso);
  return Math.round((d - now) / 60000);
}

function clampProb(p) {
  if (p == null || isNaN(p)) return null;
  return Math.max(1, Math.min(95, Math.round(p)));
}

function calcularEV(probPct, cuota) {
  if (probPct == null || cuota == null) return null;
  const p = probPct / 100;
  return Math.round(((p * (cuota - 1) - (1 - p)) * 100));
}

function formatEV(ev) {
  if (ev == null) return '—';
  return (ev >= 0 ? '+' : '') + ev + '%';
}

function formatProb(probPct) {
  return probPct == null ? '—' : (probPct + '%');
}

function formatHora(mins) {
  if (mins == null) return '—';
  if (mins < 0) return `Comenzó hace ${Math.abs(mins)} min`;
  return `Comienza en ${mins} min aprox`;
}

function normalizeStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function similarStr(a,b) {
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

// ===================== ODDs API — LISTAR PARTIDOS =====================
async function listarPartidosConCuotas() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&oddsFormat=decimal&markets=h2h,spreads,totals&apiKey=${ODDS_API_KEY}`;
  const res = await fetchWithRetry(url, {}, { retries: 1 });
  if (!res || !res.ok) {
    console.error('OddsAPI fallo:', res?.status, await safeText(res));
    return [];
  }
  const data = await safeJson(res);
  if (!Array.isArray(data)) return [];

  globalResumen.encontrados = data.length;

  const enVentana = data.filter(e => {
    const minutos = minutesUntil(e?.commence_time);
    e.minutosFaltantes = minutos;
    return (minutos >= WINDOW_MIN && minutos <= WINDOW_MAX);
  });

  console.log(`OddsAPI: recibidos=${data.length}, en_ventana=${enVentana.length} (${WINDOW_MIN}–${WINDOW_MAX}m)`);
  return enVentana.slice(0, MAX_PARTIDOS_POR_CICLO);
}

// ===================== API-FOOTBALL — ENRIQUECIMIENTO =====================
// (placeholders de ejemplo; tu implementación real ya existente)
async function enriquecerPartido(partido) {
  // Aquí va tu lógica existente que obtiene:
  // - alineaciones (o probables), árbitro y su media de tarjetas,
  // - clima, historial, forma, xG, lesiones/ausencias, etc.
  // Devuelve un objeto con esos campos. Simbólico:
  return {
    ligaPais: partido?.sport_title || 'Liga desconocida (país)',
    arbitro: { nombre: '—', mediaTarjetas: 0 },
    clima: { temp: '—', estado: '—' },
    historial: [],
    forma: [],
    xg: { local: null, visita: null },
    ausencias: []
  };
}

// ===================== SUPABASE — MEMORIA =====================
async function obtenerMemoriaSimilar({ equipos, ligaPais }) {
  // Trae últimos 5 registros como memoria “liviana”.
  const { data, error } = await supabase
    .from('picks_historicos')
    .select('evento, liga, equipos, ev, probabilidad, nivel, timestamp')
    .order('timestamp', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Supabase memoria error:', error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

// ===================== FORMATEO MENSAJES =====================
function construirMensajeGratis({ ligaPais, equipos, minutos, analisis_gratuito, frase, cta }) {
  return `📡 RADAR DE VALOR
${ligaPais}
${equipos}
${formatHora(minutos)}

${analisis_gratuito}

${frase}

¡Únete 15 días gratis al grupo VIP!
@punterxpicks

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

function construirMensajeVIP({ ligaPais, equipos, minutos, apuesta, extra, prob, ev, topBookies, analisis_vip }) {
  const top = Array.isArray(topBookies) ? topBookies : [];
  const bookiesTxt = top.slice(0,3).map((b,i) => `#${i+1} ${b?.casa || '—'}: ${b?.cuota ?? '—'}`).join('\n');

  return `🎯 PICK NIVEL: ${ev >= 40 ? 'Ultra Elite' : ev >= 30 ? 'Élite Mundial' : ev >= 20 ? 'Avanzado' : 'Competitivo'}

${ligaPais}
${equipos}
${formatHora(minutos)}

Apuesta sugerida: ${apuesta || '—'}
Apuestas extra: ${Array.isArray(extra) ? extra.join(' | ') : (extra || '—')}

Prob. estimada: ${formatProb(prob)}
EV: ${formatEV(ev)}

Mejores cuotas:
${bookiesTxt}

Datos avanzados:
${analisis_vip}

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

// ===================== TELEGRAM =====================
async function enviarMensajeTelegram(texto, tipo) {
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  // Telegram limita a 4096 caracteres por mensaje. Si excede, partimos en trozos.
  const MAX_TELEGRAM = 4096;
  const chunks = [];
  let t = String(texto || '');
  while (t.length > MAX_TELEGRAM) {
    chunks.push(t.slice(0, MAX_TELEGRAM));
    t = t.slice(MAX_TELEGRAM);
  }
  if (t) chunks.push(t);

  if (chunks.length > 1) {
    for (const [i, part] of chunks.entries()) {
      try {
        const res = await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: part })
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
    return true; // ya enviamos todos los chunks
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
async function guardarPick({ evento, analisis, apuesta, tipo_pick, liga, equipos, ev, probabilidad, nivel }) {
  try {
    const { data, error, status } = await supabase
      .from('picks_historicos')
      .insert([{ evento, analisis, apuesta, tipo_pick, liga, equipos, ev, probabilidad, nivel }]);

    if (error) {
      if (String(error.message || '').includes('duplicate key') || status === 409) {
        console.warn('Duplicado detectado (UNIQUE evento), no reenviamos.');
        return true; // ya existe → idempotencia
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

// ---------- Fallback de modelo (GPT) ----------
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
    const pick = JSON.parse(respuesta);
    return pick || null;
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

// ===================== PROCESAR PARTIDO =====================
async function procesarPartido(partido) {
  const traceId = `[evt:${partido.id}]`;

  try {
    // ---------- Enriquecer datos en paralelo ----------
    const [enri, mem] = await Promise.allSettled([
      enriquecerPartido(partido),
      obtenerMemoriaSimilar({ equipos: partido?.teams || '—', ligaPais: partido?.sport_title })
    ]);

    const enriquecido = (enri.status === 'fulfilled') ? enri.value : null;
    const memoria = (mem.status === 'fulfilled' && Array.isArray(mem.value)) ? mem.value : [];

    const P = { ...partido, ...(enriquecido || {}) };

    const prompt = construirPrompt(P, enriquecido || {}, memoria);

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

    // ---------- Prob & EV ----------
    const probPct = clampProb(estimarlaProbabilidadPct(pick, cuota));
    const ev = calcularEV(probPct, cuota);
    if (ev == null) { console.warn(traceId, 'EV nulo'); return; }

    // ---------- Clasificación y destino ----------
    const nivel = ev >= 40 ? 'Ultra Elite'
                 : ev >= 30 ? 'Élite Mundial'
                 : ev >= 20 ? 'Avanzado'
                 : ev >= 15 ? 'Competitivo'
                 : ev >= 10 ? 'Informativo'
                 : 'Descartado';

    if (nivel === 'Descartado') {
      globalResumen.descartados_ev++;
      return;
    }

    const tipo_pick = (ev >= 15) ? 'vip' : 'free';
    if (tipo_pick === 'vip') globalResumen.intentos_vip++; else globalResumen.intentos_free++;

    // ---------- Mensajes ----------
    const ligaPais = P?.ligaPais || partido?.sport_title || 'Liga desconocida (país)';
    const equipos = `${partido?.home_team || 'Local'} vs ${partido?.away_team || 'Visita'}`;
    const minutos = partido?.minutosFaltantes ?? minutesUntil(partido?.commence_time);

    const topBookies = construirTopBookies(P, pick.apuesta);

    const analisis_vip = pick.analisis_vip || '—';
    const analisis_gratuito = pick.analisis_gratuito || '—';
    const frase = pick.frase_motivacional || '—';
    const extra = Array.isArray(pick.apuestas_extra) ? pick.apuestas_extra : (pick.apuestas_extra ? [pick.apuestas_extra] : []);

    const msgVIP = construirMensajeVIP({
      ligaPais, equipos, minutos, apuesta: pick.apuesta, extra,
      prob: probPct, ev, topBookies, analisis_vip
    });

    const msgFree = construirMensajeGratis({
      ligaPais, equipos, minutos, analisis_gratuito, frase
    });

    const mensaje = (tipo_pick === 'vip') ? msgVIP : msgFree;

    // ---------- Guardar en Supabase (idempotencia por UNIQUE evento) ----------
    const evento = `${ligaPais} | ${equipos} | ${new Date(partido?.commence_time).toISOString().slice(0,16)}`;

    const okDB = await guardarPick({
      evento,
      analisis: mensaje,
      apuesta: pick.apuesta,
      tipo_pick,
      liga: ligaPais,
      equipos,
      ev,
      probabilidad: probPct,
      nivel
    });
    if (!okDB) {
      console.error(traceId, 'No se guardó en Supabase → no enviamos a Telegram');
      return;
    }

    // ---------- Enviar a Telegram ----------
    const okTelegram = await enviarMensajeTelegram(mensaje, tipo_pick);
    if (!okTelegram) {
      console.error(traceId, 'Fallo envío Telegram');
      return;
    }
    if (tipo_pick === 'vip') globalResumen.enviados_vip++; else globalResumen.enviados_free++;

  } catch (e) {
    console.error('procesarPartido error:', e?.message || e);
  }
}

// ===================== TOP BOOKIES / SELECCIÓN DE CUOTA =====================
// (implementaciones de ejemplo; ajusta a tu estructura real)
function construirTopBookies(P, apuesta) {
  const lista = Array.isArray(P?.bookies) ? P.bookies : [];
  const ordenados = lista
    .filter(x => x && x.cuota && x.casa)
    .sort((a,b) => (b.cuota - a.cuota));
  return ordenados.slice(0,3);
}

function seleccionarCuotaSegunApuesta(P, apuesta) {
  // Aquí debes mapear la apuesta textual al mercado y outcome específico.
  // Si no lo encuentras, retorna null para que el flujo use mejorCuota global.
  const lista = Array.isArray(P?.bookies) ? P.bookies : [];
  const hit = lista.find(x => similarStr(x?.mercado, apuesta) || similarStr(x?.outcome, apuesta));
  return hit ? { valor: hit.cuota } : null;
}

// ===================== PROB ESTIMADA (IA) =====================
function estimarlaProbabilidadPct(pick, cuota) {
  // Heurística simple si la IA no entrega prob; puedes mejorar con calibración histórica.
  if (pick?.probabilidad && !isNaN(pick.probabilidad)) {
    return Math.round(Number(pick.probabilidad));
  }
  if (!cuota || isNaN(cuota)) return 55; // neutral
  const implied = 100 / Number(cuota); // prob implícita
  return Math.max(10, Math.min(90, Math.round(implied)));
}

// ===================== PROMPT BUILDER =====================
function construirPrompt(P, enr, memoria) {
  const liga = P?.ligaPais || '—';
  const equipos = `${P?.home_team || 'Local'} vs ${P?.away_team || 'Visita'}`;
  const hora = formatHora(P?.minutosFaltantes ?? minutesUntil(P?.commence_time));
  const clima = enr?.clima ? `Clima: ${enr.clima.temp ?? '—'}, ${enr.clima.estado ?? '—'}` : 'Clima: —';
  const arbitro = enr?.arbitro ? `Árbitro: ${enr.arbitro.nombre ?? '—'} | Media tarjetas: ${enr.arbitro.mediaTarjetas ?? '—'}` : 'Árbitro: —';
  const xg = enr?.xg ? `xG: L=${enr.xg.local ?? '—'} V=${enr.xg.visita ?? '—'}` : 'xG: —';
  const mem = Array.isArray(memoria) && memoria.length ? `Memoria reciente:\n${memoria.map(m => `• ${m.liga} | ${m.equipos} | EV ${formatEV(m.ev)} | ${new Date(m.timestamp).toISOString().slice(0,10)}`).join('\n')}` : 'Memoria reciente: —';

  return `
Eres un analista experto en fútbol. Con los datos de abajo, devuelve SOLO un JSON válido con este formato exacto:
{
  "analisis_gratuito":"...",
  "analisis_vip":"...",
  "apuesta":"...",
  "apuestas_extra":["...", "..."],
  "frase_motivacional":"..."
}

Datos:
Liga y país: ${liga}
Equipos: ${equipos}
Hora: ${hora}
${clima}
${arbitro}
${xg}
${mem}

Cuotas top (si las hay): usa la mejor si propones una apuesta del mismo mercado.
No incluyas texto fuera del JSON.
`.trim();
}

// ===================== ORQUESTADOR =====================
async function handler() {
  try {
    const lista = await listarPartidosConCuotas();
    globalResumen.candidatos = lista.length;

    const grupo = Array.isArray(lista) ? lista : [];
    console.log('Procesando', grupo.length, 'partidos en paralelo...');
    const tasks = grupo.map(partido => procesarPartido(partido));
    await Promise.allSettled(tasks);

    // Resumen final
    const mensaje =
`Diagnóstico:
Encontrados: ${globalResumen.encontrados}
Ventana 45–55: ${globalResumen.candidatos}
Procesados: ${globalResumen.procesados}
Descartados por EV: ${globalResumen.descartados_ev}
Intentos VIP: ${globalResumen.intentos_vip} | Enviados VIP: ${globalResumen.enviados_vip}
Intentos Free: ${globalResumen.intentos_free} | Enviados Free: ${globalResumen.enviados_free}
Guardados OK: ${globalResumen.guardados_ok} | Guardados FAIL: ${globalResumen.guardados_fail}`;

    // Log y envío opcional al canal (comentado por defecto)
    console.log(mensaje);
    // await enviarMensajeTelegram(mensaje, 'free');

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, resumen: globalResumen })
    };
  } catch (e) {
    console.error('handler error:', e?.message || e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e?.message || String(e) }) };
  }
}

module.exports = { handler };
