// netlify/functions/autopick-vip-nuevo.cjs

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

// ================== ENV & CLIENTES ==================
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// ================== CONFIG PATCH v1 ==================
const K_MAX = 5;                  // Máx partidos “caros” por ciclo (enriquecer + GPT)
const WINDOW_MIN = 35;            // Ventana inferior (minutos)
const WINDOW_MAX = 55;            // Ventana superior (minutos)
const TELEGRAM_TOKEN = TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL = TELEGRAM_CHANNEL_ID;
const TELEGRAM_GROUP = TELEGRAM_GROUP_ID;

// ================== HANDLER ==================
exports.handler = async function () {
  try {
    const partidos = await obtenerPartidosDesdeOddsAPI();
    if (!Array.isArray(partidos) || partidos.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ mensaje: 'Sin partidos en ventana' }) };
    }

    // Prioriza por inicio más próximo y limita a K_MAX (cap suave)
    const candidatos = partidos.sort((a, b) => a.timestamp - b.timestamp).slice(0, K_MAX);

    for (const partido of candidatos) {
      const traceId = `[evt:${partido.id}]`;

      const yaExiste = await verificarSiYaFueEnviado(partido.id);
      if (yaExiste) { console.log(traceId, 'Ya enviado, salto'); continue; }

      // Enriquecimiento Football (tolerante a fallos; NO bloquea el flujo)
      let enriquecido = null;
      try {
        enriquecido = await enriquecerPartidoConAPIFootball(partido);
      } catch (e) {
        console.warn(traceId, 'Error enriqueciendo Football:', e?.message || e);
      }
      const infoEnriquecida = (enriquecido && Object.keys(enriquecido).length > 0) ? enriquecido : {};

      // Memoria similar (tolerante a fallos)
      const memoria = await obtenerMemoriaSimilar(partido);

      // Prompt V2 (pide probabilidad explícita)
      const prompt = construirPrompt(partido, infoEnriquecida, memoria);

      // -------- Llamada a OpenAI --------
      let pick;
      try {
        const completion = await openai.createChatCompletion({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
        });

        const respuesta = completion?.data?.choices?.[0]?.message?.content;
        if (!respuesta || typeof respuesta !== 'string') {
          console.error(traceId, 'Respuesta GPT vacía');
          continue;
        }

        try {
          pick = JSON.parse(respuesta);
        } catch (e) {
          console.error(traceId, 'JSON inválido de GPT:', respuesta.slice(0, 300));
          continue;
        }

        if (!validatePick(pick)) {
          console.warn(traceId, 'Pick incompleto', pick);
          continue;
        }
      } catch (error) {
        console.error(traceId, 'Error GPT:', error?.message || error);
        continue;
      }

      // -------- Probabilidad & EV --------
      const probPct = estimarProbabilidad(pick, partido);        // % entero
      const ev = calcularEV(probPct, partido.mejorCuota?.valor); // % entero
      if (ev == null) { console.warn(traceId, 'EV nulo'); continue; }

      if (ev < 10) { console.log(traceId, `EV ${ev}% < 10% → descartado`); continue; }

      const nivel = clasificarPickPorEV(ev);
      const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';

      // -------- Mensaje --------
      const mensaje = tipo_pick === 'vip'
        ? construirMensajeVIP(partido, pick, probPct, ev, nivel)
        : construirMensajeFree(partido, pick);

      // -------- Telegram --------
      const okTelegram = await enviarMensajeTelegram(mensaje, tipo_pick);
      if (!okTelegram) { console.error(traceId, 'Fallo Telegram, continúo'); }

      // -------- Supabase --------
      const okSave = await guardarEnSupabase(partido, pick, tipo_pick, nivel, probPct, ev);
      if (!okSave) { console.error(traceId, 'Fallo guardar en Supabase'); }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ mensaje: 'Picks procesados correctamente' }),
    };
  } catch (error) {
    console.error('Error general en autopick-vip-nuevo:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};

// ================== HELPERS ==================

// OddsAPI: URL en 1 línea, markets válidos, res.ok, ventana 35–55
async function obtenerPartidosDesdeOddsAPI() {
  if (!ODDS_API_KEY) {
    console.error('ODDS_API_KEY no definida en el entorno.');
    return [];
  }

  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${ODDS_API_KEY}&regions=eu,us,uk&markets=h2h,totals,spreads&oddsFormat=decimal`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error('Error de red al consultar OddsAPI:', e?.message || e);
    return [];
  }
  if (!res.ok) {
    const body = await safeText(res);
    console.error('Error al obtener datos de OddsAPI', res.status, body);
    return [];
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error('JSON de OddsAPI inválido');
    return [];
  }
  if (!Array.isArray(data)) return [];

  const ahora = Date.now();
  return data
    .map(evento => {
      const inicio = new Date(evento.commence_time).getTime();
      const minutosFaltantes = (inicio - ahora) / 60000;

      // Mejor cuota global (simple, de cualquier market)
      const mercados = evento.bookmakers?.flatMap(b => b.markets || []) || [];
      const mejorOutcome = mercados.flatMap(m => m.outcomes || [])
        .reduce((max, o) => (o?.price > (max?.price || 0) ? o : max), null);

      return {
        id: evento.id,
        equipos: `${evento.home_team} vs ${evento.away_team}`,
        timestamp: inicio,
        minutosFaltantes,
        mejorCuota: {
          valor: Number(mejorOutcome?.price || 1.5),
          casa: mejorOutcome?.name || 'Desconocida'
        }
      };
    })
    .filter(e => e.minutosFaltantes >= WINDOW_MIN && e.minutosFaltantes <= WINDOW_MAX);
}

// Football: tolerante; el id de OddsAPI NO es id de equipo Football. No bloqueamos si falla.
async function enriquecerPartidoConAPIFootball(partido) {
  if (!API_FOOTBALL_KEY) return null;

  const url = `https://v3.football.api-sports.io/fixtures?team=${encodeURIComponent(partido.id)}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
  } catch (e) {
    console.error(`[evt:${partido.id}] Error de red Football:`, e?.message || e);
    return null;
  }

  if (!res.ok) {
    console.error(`[evt:${partido.id}] Football no ok:`, res.status, await safeText(res));
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`[evt:${partido.id}] JSON Football inválido`);
    return null;
  }

  const info = data?.response?.[0] || null;
  if (!info) return null;

  const liga =
    info?.league
      ? `${info.league?.country || ''}${info.league?.country ? ' - ' : ''}${info.league?.name || ''}`.trim()
      : null;

  return {
    ...partido,
    liga: liga || partido.liga || null,
    fixture_id: info?.fixture?.id || null,
  };
}

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

// Prompt V2: pide probabilidad explícita (0.05–0.85)
function construirPrompt(partido, info, memoria) {
  const datosClave = {
    liga: info?.liga || 'No especificada',
    equipos: partido.equipos,
    hora_estimada: 'Comienza en menos de 1 hora',
    cuota_maxima: partido.mejorCuota?.valor,
    bookie: partido.mejorCuota?.casa,
  };

  return `
Eres un analista deportivo profesional. Devuelve SOLO JSON válido con estas claves:
- analisis_gratuito (máx 5-6 oraciones, conciso y claro)
- analisis_vip (máx 5-6 oraciones, táctico y con argumentos de datos)
- apuesta (ej.: "Más de 2.5 goles", "Ambos anotan", "1X2 local")
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

// Probabilidad: usa la de la IA si viene; si no, fallback a implícita 100/cuota
function estimarProbabilidad(pick, partido) {
  if (pick && typeof pick.probabilidad !== 'undefined') {
    const v = Number(pick.probabilidad);
    if (!Number.isNaN(v)) {
      if (v > 0 && v < 1) return Math.round(v * 100); // 0–1 → %
      if (v >= 1 && v <= 100) return Math.round(v);   // ya viene en %
    }
  }
  const cuota = Number(partido?.mejorCuota?.valor);
  if (!cuota || cuota <= 1.01) return 0;
  return Math.round(100 / cuota);
}

// EV% = (p*cuota - 1)*100, donde p es decimal
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

function construirMensajeVIP(partido, pick, probabilidadPct, ev, nivel) {
  return `
🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.equipos}
🕒 Comienza en menos de 1 hora

📊 Cuota: ${partido.mejorCuota.valor} (${partido.mejorCuota.casa})
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
📅 ${partido.equipos}
🕒 Comienza en menos de 1 hora

📌 Análisis de los expertos:
${pick.analisis_gratuito}

💬 ${pick.frase_motivacional}

🎁 ¡Únete 15 días gratis al grupo VIP!
@punterxpicks

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

async function enviarMensajeTelegram(texto, tipo) {
  if (!TELEGRAM_TOKEN) { console.error('TELEGRAM_BOT_TOKEN no definido'); return false; }
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP : TELEGRAM_CHANNEL;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto })
    });
    if (!res.ok) {
      const body = await safeText(res);
      console.error('Error Telegram:', res.status, body);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error de red Telegram:', e?.message || e);
    return false;
  }
}

async function guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidadPct, ev) {
  try {
    const { error } = await supabase.from('picks_historicos').insert([{
      evento: partido.id,
      analisis: pick.analisis_vip,
      apuesta: pick.apuesta,
      tipo_pick,
      liga: partido.liga || 'No especificada',
      equipos: partido.equipos,
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

async function obtenerMemoriaSimilar(partido) {
  try {
    const local = (partido?.equipos || '').split(' vs ')[0] || '';
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('evento, analisis, apuesta, equipos, ev')
      .ilike('equipos', `%${local}%`)
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

function validatePick(pick) {
  if (!pick) return false;
  if (!pick.analisis_vip || !pick.analisis_gratuito) return false;
  if (!pick.apuesta) return false;
  return true;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
