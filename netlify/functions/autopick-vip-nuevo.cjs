// netlify/functions/autopick-vip-nuevo.cjs

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

// =============== ENV & CLIENTES =================
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  OPENAI_MODEL // opcional, por defecto gpt-4
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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
const MODEL = OPENAI_MODEL || 'gpt-4';

// =============== CONFIG PATCH v2 =================
const WINDOW_MIN = 35; // minutos
const WINDOW_MAX = 55; // minutos

const K_MIN = 3;       // cap mínimo por ciclo (fase cara)
const K_MAX = 6;       // cap máximo por ciclo
const CONCURRENCY = 3; // cuántos partidos "caros" en paralelo

const REQUEST_TIMEOUT_MS = 8000;
const RETRIES = 2;
const BACKOFF_MS = 600;

// =============== UTILS (fetch c/ retry & timeout) ===============
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
        // Reintentos solo en 429/5xx
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

// =============== HANDLER =================
exports.handler = async function () {
  try {
    assertEnv();

    const partidos = await obtenerPartidosDesdeOddsAPI();
    if (!Array.isArray(partidos) || partidos.length === 0) {
      console.log('OddsAPI: sin partidos en ventana');
      return { statusCode: 200, body: JSON.stringify({ mensaje: 'Sin partidos en ventana' }) };
    }

    // Prioriza por inicio más próximo
    const ordenados = partidos.sort((a, b) => a.timestamp - b.timestamp);

    // Cap dinámico simple: si hay muchos partidos, usa K_MAX; si hay pocos, al menos K_MIN
    const K = Math.max(K_MIN, Math.min(K_MAX, ordenados.length));
    const candidatos = ordenados.slice(0, K);

    // Resumen de ciclo
    const resumen = {
      encontrados: partidos.length,
      candidatos: candidatos.length,
      procesados: 0,
      descartados_ev: 0,
      intentos_vip: 0,
      intentos_free: 0,
      enviados_vip: 0,
      enviados_free: 0,
      guardados_ok: 0,
      guardados_fail: 0
    };

    // Procesa en paralelo controlado
    const chunks = chunkArray(candidatos, CONCURRENCY);
    for (const grupo of chunks) {
      const tasks = grupo.map(partido => procesarPartido(partido, resumen));
      await Promise.allSettled(tasks);
    }

    console.log('Resumen ciclo:', JSON.stringify(resumen));
    return {
      statusCode: 200,
      body: JSON.stringify({ mensaje: 'Picks procesados correctamente', resumen })
    };
  } catch (error) {
    console.error('❌ Error general en autopick-vip-nuevo:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno del servidor' }) };
  }
};

// =============== PIPELINE POR PARTIDO =================
async function procesarPartido(partido) {
  const traceId = `[evt:${partido.id}]`;
  try {
    // Evita duplicados
    const yaExiste = await verificarSiYaFueEnviado(partido.id);
    if (yaExiste) { console.log(traceId, 'Ya enviado, salto'); return; }

    // Enriquecimiento Football + memoria (en paralelo, tolerante a fallos)
    const [enriqRes, memRes] = await Promise.allSettled([
      enriquecerPartidoConAPIFootball(partido),
      obtenerMemoriaSimilar(partido)
    ]);

    const enriquecido = (enriqRes.status === 'fulfilled' && enriqRes.value) ? enriqRes.value : null;
    const memoria = (memRes.status === 'fulfilled' && Array.isArray(memRes.value)) ? memRes.value : [];

    // Merge no bloqueante: si Football trae liga/fixture, úsalo
    const P = { ...partido, ...(enriquecido || {}) };

    const prompt = construirPrompt(P, enriquecido || {}, memoria);

    // -------- Llamada a OpenAI --------
    let pick;
    try {
      const completion = await openai.createChatCompletion({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        // max_tokens opcional; si tu prompt crece, limítalo (p.ej. 400)
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

    // -------- Selección de cuota según apuesta --------
    const cuotaSeleccionada = seleccionarCuotaSegunApuesta(P, pick.apuesta);
    if (!cuotaSeleccionada || !cuotaSeleccionada.valor) {
      console.warn(traceId, 'No se encontró cuota coherente con la apuesta; uso mejorCuota global');
    }
    const cuota = (cuotaSeleccionada && cuotaSeleccionada.valor) ? cuotaSeleccionada.valor : P?.mejorCuota?.valor;

    // -------- Probabilidad & EV --------
    const probPct = clampProb(estimarlaProbabilidadPct(pick, cuota)); // 5–85
    const ev = calcularEV(probPct, cuota); // % entero
    if (ev == null) { console.warn(traceId, 'EV nulo'); return; }

    // Contador procesados
    globalResumen.procesados++;

    if (ev < 10) { globalResumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); return; }

    const nivel = clasificarPickPorEV(ev);
    const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';

    if (tipo_pick === 'vip') globalResumen.intentos_vip++;
    else globalResumen.intentos_free++;

    // -------- Mensaje --------
    const mensaje = tipo_pick === 'vip'
      ? construirMensajeVIP(P, pick, probPct, ev, nivel)
      : construirMensajeFree(P, pick);

    // -------- Telegram --------
    const okTelegram = await enviarMensajeTelegram(mensaje, tipo_pick);
    if (okTelegram) {
      if (tipo_pick === 'vip') globalResumen.enviados_vip++;
      else globalResumen.enviados_free++;
    } else {
      console.error(traceId, 'Fallo Telegram (no bloquea)');
    }

    // -------- Supabase --------
    const okSave = await guardarEnSupabase(P, pick, tipo_pick, nivel, probPct, ev);
    if (okSave) globalResumen.guardados_ok++;
    else { globalResumen.guardados_fail++; console.error(traceId, 'Fallo guardar en Supabase'); }
  } catch (e) {
    console.error(traceId, 'Excepción procesando partido:', e?.message || e);
  }
}

// variable interna para el resumen (mutado dentro de procesarPartido)
const globalResumen = {
  encontrados: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
  intentos_vip: 0, intentos_free: 0, enviados_vip: 0, enviados_free: 0,
  guardados_ok: 0, guardados_fail: 0
};

// =============== OBTENER PARTIDOS (OddsAPI) =================
async function obtenerPartidosDesdeOddsAPI() {
  // Calcula ventana y genera ISO sin milisegundos (YYYY-MM-DDTHH:MM:SSZ)
  const now = new Date();
  const fromISO = new Date(now.getTime() + WINDOW_MIN * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const toISO   = new Date(now.getTime() + WINDOW_MAX * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds` +
    `?apiKey=${ODDS_API_KEY}` +
    `&regions=eu,us,uk` +
    `&markets=h2h,totals,spreads` +
    `&oddsFormat=decimal` +
    `&dateFormat=iso` +
    `&commenceTimeFrom=${fromISO}` +
    `&commenceTimeTo=${toISO}`;

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
    console.log('URL usada:', url);
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

  // Normaliza todos los eventos y separa en ventana / fuera de ventana con motivos
  const mapeados = data
    .map(evento => normalizeOddsEvent(evento, ahora))
    .filter(Boolean);

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

  // para el resumen global del ciclo
  globalResumen.encontrados = data.length;

  return enVentana;
}

// =============== ENRIQUECER (API-FOOTBALL) =================
// Matching por nombre + fecha (search + filtro por cercanía de hora)
async function enriquecerPartidoConAPIFootball(partido) {
  if (!API_FOOTBALL_KEY) return null;

  // Usamos 'search' con ambos nombres; luego filtramos por cercanía de fecha/hora
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

  // Selecciona el fixture cuya fecha/teams más se acerque
  const targetTs = partido.timestamp;
  let best = null;
  let bestDiff = Infinity;

  for (const it of list) {
    const thome = it?.teams?.home?.name || '';
    const taway = it?.teams?.away?.name || '';
    const ts = it?.fixture?.date ? new Date(it.fixture.date).getTime() : null;
    if (!ts) continue;

    // simple heuristic: nombres incluidos y diferencia < 24h
    const namesOk =
      includesLoose(thome, partido.home) &&
      includesLoose(taway, partido.away);
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

function includesLoose(a, b) {
  if (!a || !b) return false;
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  return na.includes(nb) || nb.includes(na);
}
function normalizeStr(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// =============== MEMORIA =================
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

// =============== OPENAI PROMPT =================
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
- apuesta (ej.: "Más de 2.5 goles", "Menos de 2.5 goles", "1X2 local", "Hándicap", etc.)
- apuestas_extra (texto breve con 1-3 ideas extra si hay señales)
- frase_motivacional (1 línea, sin emojis)
- probabilidad (número decimal entre 0.05 y 0.85 que representa prob. de acierto de la apuesta principal; ej: 0.62)

No inventes datos no proporcionados. Sé específico.

Datos_clave:
${JSON.stringify(datosClave)}

Memoria_relevante:
${JSON.stringify((memoria || []).slice(0,3))}
`.trim();
}

// =============== PROBABILIDAD & EV =================
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

// =============== SELECCIÓN DE CUOTA POR MERCADO =================
function seleccionarCuotaSegunApuesta(partido, apuesta) {
  const text = String(apuesta || '').toLowerCase();

  const m = partido?.marketsBest || {};
  // totals
  if (text.includes('más de') || text.includes('over') || text.includes('total')) {
    // preferimos over si existe; si no, under
    if (m.totals && m.totals.over) return { valor: m.totals.over.valor, label: 'over', point: m.totals.over.point };
    if (m.totals && m.totals.under) return { valor: m.totals.under.valor, label: 'under', point: m.totals.under.point };
  }
  if (text.includes('menos de') || text.includes('under')) {
    if (m.totals && m.totals.under) return { valor: m.totals.under.valor, label: 'under', point: m.totals.under.point };
    if (m.totals && m.totals.over) return { valor: m.totals.over.valor, label: 'over', point: m.totals.over.point };
  }

  // spreads / handicap
  if (text.includes('hándicap') || text.includes('handicap') || text.includes('spread')) {
    if (m.spreads) return { valor: m.spreads.valor, label: m.spreads.label, point: m.spreads.point };
  }

  // default: h2h
  if (m.h2h) return { valor: m.h2h.valor, label: m.h2h.label };
  // fallback global
  if (partido?.mejorCuota?.valor) return partido.mejorCuota;
  return null;
}

// =============== MENSAJES =================
function construirMensajeVIP(partido, pick, probabilidadPct, ev, nivel) {
  return `
🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.home} vs ${partido.away}
🕒 Comienza en menos de 1 hora

📊 Cuota: ${Number(partido?.mejorCuota?.valor || 0).toFixed(2)} (${partido?.mejorCuota?.casa || 'N/D'})
📈 Probabilidad estimada: ${Math.round(probabilidadPct)}%
💰 Valor esperado: ${ev}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra || 'N/A'}

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

// =============== TELEGRAM =================
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

// =============== SUPABASE =================
async function verificarSiYaFueEnviado(idEvento) {
  const { data, error } = await supabase
    .from('picks_historicos')
    .select('evento')
    .eq('evento', idEvento);

  if (error) {
    console.error('Supabase error al verificar:', error.message);
    return false;
  }
  return !!(data && data.length > 0);
}

async function guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidadPct, ev) {
  try {
    const { error } = await supabase.from('picks_historicos').insert([{
      evento: partido.id,
      analisis: pick.analisis_vip,
      apuesta: pick.apuesta,
      tipo_pick,
      liga: partido.liga || 'No especificada',
      equipos: `${partido.home} vs ${partido.away}`,
      ev,
      probabilidad: probabilidadPct,
      nivel,
      timestamp: new Date().toISOString()
    }]);
    if (error) {
      console.error('Supabase insert error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Supabase excepción insert:', e?.message || e);
    return false;
  }
}

// =============== VALIDACIONES BÁSICAS =================
function validatePick(pick) {
  if (!pick) return false;
  if (!pick.analisis_vip || !pick.analisis_gratuito) return false;
  if (!pick.apuesta) return false;
  return true;
}

// =============== HELPERS =================
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
