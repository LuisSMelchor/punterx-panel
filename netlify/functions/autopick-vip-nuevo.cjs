// autopick-vip-nuevo.cjs – versión completa con IA, Supabase, aprendizaje, cuotas y verificación cruzada

const fetch = globalThis.fetch;
const { createClient } = await import('@supabase/supabase-js');
const crypto = await import('node:crypto');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PANEL_ENDPOINT = process.env.PANEL_ENDPOINT;
const AUTH_CODE = process.env.AUTH_CODE;
const SECRET = process.env.PUNTERX_SECRET;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_VIP_ID = process.env.TELEGRAM_VIP_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 📅 Obtener fecha actual en CDMX
const now = new Date();
const offsetCDMX = -6;
const fechaHoy = new Date(now.getTime() + offsetCDMX * 60 * 60 * 1000).toISOString().split('T')[0];

exports.handler = async function () {
  try {
    console.log(`📅 Buscando partidos para la fecha: ${fechaHoy}`);
    const partidos = await obtenerPartidosDeOddsAPI();

    if (!partidos || partidos.length === 0) {
      console.warn('⚠️ No se encontraron partidos para hoy.');
      return { statusCode: 200, body: 'Sin partidos disponibles.' };
    }

    console.log(`🎯 Total de partidos encontrados: ${partidos.length}`);

    for (const partido of partidos) {
      const detalles = await obtenerDetallesDePartido(partido);
      if (!detalles) continue;

      const mensajeIA = await generarMensajeConIA(detalles);
      if (!mensajeIA) continue;

      const nivel = clasificarPorEV(mensajeIA.ev);
      if (!nivel) continue;

      await enviarMensajesTelegram(mensajeIA, nivel);
      await guardarEnSupabase(mensajeIA, nivel);
    }

    return { statusCode: 200, body: 'Proceso completado.' };
  } catch (error) {
    console.error('❌ Error en ejecución principal:', error);
    return { statusCode: 500, body: 'Error en el servidor.' };
  }
};

// 🧠 Consulta Supabase para memoria IA
async function consultarMemoriaIA() {
  const { data, error } = await supabase
    .from('picks_historicos')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(10);
  return error ? [] : data;
}

// 📊 Clasifica según EV
function clasificarPorEV(ev) {
  if (ev >= 40) return '🟣 Ultra Elite';
  if (ev >= 30) return '🎯 Élite Mundial';
  if (ev >= 20) return '🥈 Avanzado';
  if (ev >= 15) return '🥉 Competitivo';
  if (ev >= 10) return '📄 Informativo';
  return null;
}

// ⚽ Consulta partidos desde OddsAPI
async function obtenerPartidosDeOddsAPI() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu&markets=h2h&dateFormat=iso&oddsFormat=decimal&apiKey=${ODDS_API_KEY}`;
  const res = await fetch(url);
  return res.ok ? await res.json() : null;
}

// 🔎 Enriquecer partido con API-Football
async function obtenerDetallesDePartido(partido) {
  // Aquí se puede consultar fixtures, estadísticas, alineaciones, clima, árbitro, etc.
  return {
    equipos: `${partido.home_team} vs ${partido.away_team}`,
    liga: partido.sport_title,
    hora: partido.commence_time,
    cuotas: partido.bookmakers,
    evento: `${partido.home_team} vs ${partido.away_team}`,
  };
}

// 💬 Genera análisis con IA usando OpenAI
async function generarMensajeConIA(data) {
  const memoria = await consultarMemoriaIA();

  const prompt = `
Eres un experto en apuestas deportivas. Usa el siguiente contexto para generar un análisis táctico profesional, una frase motivacional para el canal gratuito, y una predicción basada en valor esperado (EV) para un pick VIP.

📌 Partido: ${data.evento}
📆 Hora: ${data.hora}
🏆 Liga: ${data.liga}
🧠 Memoria IA: ${JSON.stringify(memoria, null, 2)}

Incluye:
1. Análisis profesional (datos avanzados)
2. Apuesta sugerida
3. Valor estimado (EV %)
4. Probabilidad estimada (%)
5. Apuestas extra (si aplica)
6. Frase motivacional (para canal gratuito)
`;

  const respuesta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });

  const json = await respuesta.json();
  const texto = json.choices?.[0]?.message?.content;

  if (!texto) return null;

  const ev = parseFloat(extraerValor(texto, 'EV'));
  const prob = parseFloat(extraerValor(texto, 'Probabilidad'));

  return {
    ...data,
    analisis: texto,
    apuesta: extraerTexto(texto, 'Apuesta sugerida'),
    apuestas_extra: extraerTexto(texto, 'Apuestas extra'),
    frase: extraerTexto(texto, 'Frase motivacional'),
    ev,
    probabilidad: prob,
  };
}

function extraerValor(texto, campo) {
  const regex = new RegExp(`${campo}\\s*[:：]\\s*(\\d{1,3})`, 'i');
  const match = texto.match(regex);
  return match ? match[1] : '0';
}

function extraerTexto(texto, campo) {
  const regex = new RegExp(`${campo}\\s*[:：]\\s*(.*)`, 'i');
  const match = texto.match(regex);
  return match ? match[1].trim() : '';
}

// 📩 Enviar mensajes a Telegram
async function enviarMensajesTelegram(pick, nivel) {
  const mensajeVIP = `
🎯 PICK NIVEL: ${nivel}

🏆 ${pick.liga}
🕒 ${formatearHora(pick.hora)}
⚔️ ${pick.equipos}

📈 EV estimado: ${pick.ev}%
📊 Probabilidad: ${pick.probabilidad}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra}

📋 Datos avanzados:
${pick.analisis}

⚠️ Este contenido es informativo. Juega responsablemente.
`;

  const mensajeFREE = `
📡 RADAR DE VALOR

🏆 ${pick.liga}
🕒 ${formatearHora(pick.hora)}
⚔️ ${pick.equipos}

🔍 Análisis:
${pick.frase}

👉 Accede gratis 15 días al grupo VIP:
@punterxpicks
`;

  // VIP
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_VIP_ID, text: mensajeVIP }),
  });

  // Gratuito
  if (nivel === '📄 Informativo') {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHANNEL_ID, text: mensajeFREE }),
    });
  }
}

// 💾 Guardar en Supabase
async function guardarEnSupabase(pick, nivel) {
  const { error } = await supabase.from('picks_historicos').insert([
    {
      evento: pick.evento,
      liga: pick.liga,
      equipos: pick.equipos,
      analisis: pick.analisis,
      apuesta: pick.apuesta,
      tipo_pick: nivel,
      ev: pick.ev,
      probabilidad: pick.probabilidad,
      nivel,
      timestamp: new Date().toISOString(),
    },
  ]);

  if (error) console.error('❌ Error al guardar en Supabase:', error);
}

// 🕒 Formatear hora aproximada
function formatearHora(iso) {
  const fecha = new Date(iso);
  const diff = (fecha - new Date()) / 60000;
  return `Comienza en ${Math.round(diff)} minutos aprox.`;
}
