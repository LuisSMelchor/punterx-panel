const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Validar variables de entorno
const requiredEnv = [
  'OPENAI_API_KEY',
  'API_FOOTBALL_KEY',
  'ODDS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHANNEL_ID',
  'TELEGRAM_GROUP_ID',
];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Falta la variable de entorno: ${env}`);
    process.exit(1);
  }
}

// Instancias
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Utilidades
const formatearHora = (fechaUTC) => {
  const opciones = {
    timeZone: 'America/Mexico_City',
    hour: 'numeric',
    minute: 'numeric',
  };
  return new Date(fechaUTC).toLocaleTimeString('es-MX', opciones);
};

// Obtener partidos desde OddsAPI
async function obtenerPartidosConCuotas() {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${process.env.ODDS_API_KEY}&regions=eu&markets=totals,spreads,h2h&dateFormat=iso&oddsFormat=decimal`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`❌ Error al obtener cuotas OddsAPI: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Obtener datos enriquecidos desde API-Football
async function obtenerDatosAvanzados(fixtureId) {
  try {
    const headers = { 'x-apisports-key': process.env.API_FOOTBALL_KEY };
    const endpoints = [
      `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
      `https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`,
      `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`,
      `https://v3.football.api-sports.io/fixtures/players?fixture=${fixtureId}`,
      `https://v3.football.api-sports.io/fixtures/headtohead?h2h=${fixtureId}`,
      `https://v3.football.api-sports.io/fixtures?fixture=${fixtureId}&timezone=America/Mexico_City`
    ];
    const results = {};
    for (const url of endpoints) {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const json = await res.json();
      const key = url.split('?')[0].split('/').pop();
      results[key] = json.response;
      await delay(150);
    }
    return results;
  } catch (err) {
    console.error(`❌ Error en datos avanzados: ${err}`);
    return {};
  }
}

// Enviar a Telegram
async function enviarTelegram(mensaje, chatId) {
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: 'HTML' }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`Telegram error: ${json.description}`);
  } catch (err) {
    console.error(`❌ Telegram: ${err.message}`);
  }
}

// Generar análisis con IA
async function generarAnalisisIA(prompt) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content); // se asume formato JSON válido
  } catch (err) {
    console.error(`❌ OpenAI: ${err.message}`);
    return null;
  }
}

// Calcular Expected Value
function calcularEV(probabilidadIA, cuota) {
  const ev = ((probabilidadIA * cuota - 1) * 100).toFixed(0);
  return Number(ev);
}

// Clasificación del pick según EV
function clasificarEV(ev) {
  if (ev >= 40) return '🟣 Ultra Elite';
  if (ev >= 30) return '🎯 Élite Mundial';
  if (ev >= 20) return '🥈 Avanzado';
  if (ev >= 15) return '🥉 Competitivo';
  if (ev >= 10) return '📄 Informativo';
  return null;
}

// Guardar en Supabase
async function guardarPick(pick) {
  try {
    const { error } = await supabase.from('picks_historicos').insert([pick]);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`❌ Supabase: ${err.message}`);
  }
}

// FORMATO MENSAJE
function crearMensaje(pick, tipo) {
  const { liga, equipos, hora, apuesta, ev, probabilidad, analisis, nivel } = pick;
  if (tipo === 'vip') {
    return `🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${liga}
📅 Partido: ${equipos}
🕒 Hora: ${hora}
📈 EV: ${ev}% | Prob: ${probabilidad}%
💡 Apuesta sugerida: ${apuesta}
📊 Datos avanzados: ${analisis}
⚠️ Este contenido es informativo. Apostar conlleva riesgo.`;
  } else {
    return `📡 RADAR DE VALOR
🏆 Liga: ${liga}
📅 Partido: ${equipos}
🕒 Hora: ${hora}
📊 ${analisis}
🔓 Accede al grupo VIP gratis 15 días.
⚠️ Apuesta bajo tu responsabilidad.`;
  }
}

// HANDLER PRINCIPAL
exports.handler = async function () {
  try {
    const partidos = await obtenerPartidosConCuotas();
    const horaActual = new Date();
    const seleccionados = [];

    for (const p of partidos) {
      const fecha = new Date(p.commence_time);
      const minutos = (fecha - horaActual) / 60000;
      if (minutos >= 45 && minutos <= 55) {
        const fixtureId = p.id || 'NO_ID';
        const datos = await obtenerDatosAvanzados(fixtureId);

        const prompt = `Analiza este partido considerando todos estos datos reales y genera:
- un análisis profesional
- una apuesta sugerida (solo si hay señales fuertes)
- apuestas extra si aplica
- una probabilidad estimada
Devuélvelo como JSON válido.

Datos:
Equipos: ${p.home_team} vs ${p.away_team}
Liga: ${p.sport_title}
Hora: ${formatearHora(p.commence_time)}
Cuotas: ${JSON.stringify(p.bookmakers)}
Datos API-Football: ${JSON.stringify(datos)}`;

        const respuestaIA = await generarAnalisisIA(prompt);
        if (!respuestaIA) continue;

        const mejorCuota = p.bookmakers?.[0]?.markets?.[0]?.outcomes?.[0]?.price || 1.7;
        const probabilidad = respuestaIA.probabilidad || 55;
        const ev = calcularEV(probabilidad / 100, mejorCuota);
        const nivel = clasificarEV(ev);
        if (!nivel) continue;

        const pick = {
          evento: `${p.home_team} vs ${p.away_team}`,
          liga: p.sport_title,
          equipos: `${p.home_team} vs ${p.away_team}`,
          hora: `Comienza en ${Math.round(minutos)} minutos`,
          apuesta: respuestaIA.apuesta || 'No definida',
          tipo_pick: nivel,
          ev,
          probabilidad,
          analisis: respuestaIA.analisis || respuestaIA.analisis_vip || '',
          nivel,
          timestamp: new Date().toISOString(),
        };

        // Guardar y enviar
        await guardarPick(pick);
        const mensaje = crearMensaje(pick, nivel === '📄 Informativo' ? 'free' : 'vip');
        const chatId = nivel === '📄 Informativo' ? process.env.TELEGRAM_CHANNEL_ID : process.env.TELEGRAM_GROUP_ID;
        await enviarTelegram(mensaje, chatId);
        seleccionados.push(pick);
        await delay(1200); // evitar bloqueos
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'ok',
        total_picks: seleccionados.length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (err) {
    console.error('❌ Error general:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
