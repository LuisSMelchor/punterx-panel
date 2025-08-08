const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_GROUP = process.env.TELEGRAM_GROUP_ID;

// --------------------- CONFIG PATCH v1 --------------------
const K_MAX = 5;                  // Máx partidos “caros” por ciclo (enriquecer + GPT)
const WINDOW_MIN = 35;            // Ventana inferior (minutos)
const WINDOW_MAX = 55;            // Ventana superior (minutos)
// ---------------------------------------------------------

exports.handler = async function () {
  try {
    const partidos = await obtenerPartidosDesdeOddsAPI();
    if (!Array.isArray(partidos) || partidos.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ mensaje: 'Sin partidos en ventana' }) };
    }

    // Prioriza por tiempo de inicio más cercano y limita a K_MAX (cap suave)
    const candidatos = partidos
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, K_MAX);

    for (const partido of candidatos) {
      const traceId = `[evt:${partido.id}]`;

      const yaExiste = await verificarSiYaFueEnviado(partido.id);
      if (yaExiste) { console.log(traceId, 'Ya enviado, salto'); continue; }

      // Enriquecer (no bloqueante si falla)
      const enriquecido = await enriquecerPartidoConAPIFootball(partido);
      if (!enriquecido || Object.keys(enriquecido).length === 0) {
        console.warn(traceId, 'Sin datos Football útiles, salto');
        continue;
      }

      // Memoria similar
      const memoria = await obtenerMemoriaSimilar(partido);

      // Prompt V2 (pide probabilidad)
      const prompt = construirPrompt(partido, enriquecido, memoria);

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

      // Probabilidad y EV (EV = p*cuota - 1)
      const pDec = estimarProbabilidadDecimal(pick, partido.mejorCuota?.valor);
      const ev = calcularEVDesdeProb(pDec, partido.mejorCuota?.valor);
      if (ev == null) { console.warn(traceId, 'EV nulo'); continue; }

      // Filtro por EV mínimo (mantiene tu lógica de envío)
      if (ev < 10) { console.log(traceId, `EV ${ev}% < 10% → descartado`); continue; }

      const nivel = clasificarPickPorEV(ev);
      const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';

      const probPercent = Math.round((pDec || 0) * 100);

      const mensaje = tipo_pick === 'vip'
        ? construirMensajeVIP(partido, pick, probPercent, ev, nivel)
        : construirMensajeFree(partido, pick);

      // Envío a Telegram con verificación
      const okTelegram = await enviarMensajeTelegram(mensaje, tipo_pick);
      if (!okTelegram) { console.error(traceId, 'Fallo Telegram, continúo'); }

      // Guardar en Supabase con verificación
      const okSave = await guardarEnSupabase(partido, pick, tipo_pick, nivel, probPercent, ev);
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

// --------------------- HELPERS ----------------------------

// PATCH v1: URL en una línea + btts + res.ok + validaciones + ventana 35–55
async function obtenerPartidosDesdeOddsAPI() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,totals,spreads`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error('Error de red al consultar OddsAPI:', e?.message || e);
    return [];
  }
  if (!res.ok) {
    console.error('OddsAPI no ok:', res.status, await safeText(res));
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

      // Flatten markets para obtener una mejor cuota global (manteniendo tu enfoque)
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

// PATCH v1: res.ok + retorno seguro; NOTA: el id de OddsAPI no es id de equipo en Football.
// Lo dejamos tolerante a fallos; si no hay datos útiles, devolvemos null y seguimos.
async function enriquecerPartidoConAPIFootball(partido) {
  const url = `https://v3.football.api-sports.io/fixtures?team=${encodeURIComponent(partido.id)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
    });
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

  // Añadimos liga si está disponible (para evitar "No especificada")
  const liga =
    info?.league
      ? `${info.league?.country || ''}${info.league?.country ? ' - ' : ''}${info.league?.name || ''}`.trim()
      : null;

  return {
    ...partido,
    liga: liga || partido.liga || null,
    fixture_id: info?.fixture?.id || null,
    // (Dejamos el resto de datos complejos para Patch v2 con matching por nombre/fecha)
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

// PATCH v1: Prompt V2, pidiendo "probabilidad" explícita (0–1)
function construirPrompt(partido, info, memoria) {
  const datosClave = {
    liga: info?.liga || 'No especificada',
    equipos: partido.equipos,
    hora_estimada: 'Comienza en menos de 1 hora',
    cuota_maxima: partido.mejorCuota?.valor,
    bookie: partido.mejorCuota?.casa,
    // Futuro: adjuntar más campos clave si están disponibles de Football (alineaciones, árbitro, etc.)
  };

  return `
Eres un analista deportivo profesional. Devuelve SOLO JSON válido con estas claves:
- analisis_gratuito (máx 5-6 oraciones, conciso y claro)
- analisis_vip (máx 5-6 oraciones, táctico y con argumentos de datos)
- apuesta (ejemplos: "Más de 2.5 goles", "Ambos anotan", "1X2 local", etc.)
- apuestas_extra (texto breve con 1-3 ideas extra si hay señales)
- frase_motivacional (1 línea, sin emojis)
- probabilidad (número decimal entre 0.05 y 0.85 que representa prob de acierto de la apuesta principal; ej: 0.62)

No inventes datos no proporcionados. Sé específico.

Datos_clave:
${JSON.stringify(datosClave)}

Memoria_relevante:
${JSON.stringify((memoria || []).slice(0,3))}
`.trim();
}

// PATCH v1: Probabilidad segura (usa la de GPT si está; si no, fallback a 1/cuota con penalización)
function estimarProbabilidadDecimal(pick, cuota) {
  let p = null;
  if (pick && typeof pick.probabilidad !== 'undefined') {
    const v = Number(pick.probabilidad);
    if (!Number.isNaN(v)) {
      if (v > 0 && v < 1) p = v;
      else if (v > 1 && v <= 100) p = v / 100;
    }
  }
  if (!p && cuota) {
    // Fallback conservador: prob implícita penalizada
    const c = Number(cuota);
    if (c > 1.01) p = Math.min(0.85, Math.max(0.05, (1 / c) * 0.92));
  }
  return p;
}

// PATCH v1: EV correcto (devuelve en % redondeado)
function calcularEVDesdeProb(probDecimal, cuota) {
  if (!probDecimal || !cuota) return null;
  const evDecimal = probDecimal * Number(cuota) - 1;
  return Math.round(evDecimal * 100);
}

// (Mantengo tu clasificación por EV)
function clasificarPickPorEV(ev) {
  if (ev >= 40) return 'Ultra Elite';
  if (ev >= 30) return 'Élite Mundial';
  if (ev >= 20) return 'Avanzado';
  if (ev >= 15) return 'Competitivo';
  return 'Informativo';
}

// (Mantengo tus plantillas de mensajes; solo paso prob% ya calculado)
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

// PATCH v1: Telegram con verificación de estado
async function enviarMensajeTelegram(texto, tipo) {
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP : TELEGRAM_CHANNEL;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto })
    });
    if (!res.ok) {
      console.error('Telegram no ok:', res.status, await safeText(res));
      return false;
    }
    return true;
  } catch (e) {
    console.error('Error de red Telegram:', e?.message || e);
    return false;
  }
}

// PATCH v1: Supabase con control de error
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

// Mantengo tu función, añado control básico por si falla split.
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

// Validación mínima del pick IA
function validatePick(pick) {
  if (!pick) return false;
  if (!pick.analisis_vip || !pick.analisis_gratuito) return false;
  if (!pick.apuesta) return false;
  return true;
}

// Helper pequeño para leer error body
async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}
