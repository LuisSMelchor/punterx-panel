// autopick-vip-nuevo.cjs
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

exports.handler = async function () {
  // ✅ VALIDACIÓN DE VARIABLES DE ENTORNO
  const {
    OPENAI_API_KEY,
    SUPABASE_URL,
    SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID,
    TELEGRAM_GROUP_ID,
    ODDS_API_KEY,
    API_FOOTBALL_KEY,
    PUNTERX_SECRET,
    AUTH_CODE
  } = process.env;

  const requiredVars = {
    OPENAI_API_KEY,
    SUPABASE_URL,
    SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID,
    TELEGRAM_GROUP_ID,
    ODDS_API_KEY,
    API_FOOTBALL_KEY,
    PUNTERX_SECRET,
    AUTH_CODE
  };

  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value) {
      console.error(`❌ Missing environment variable: ${key}`);
      return {
        statusCode: 500,
        body: `Missing environment variable: ${key}`
      };
    }
  }

  // 🧠 INICIALIZACIÓN DE SERVICIOS
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const openai = new OpenAIApi(new Configuration({ apiKey: OPENAI_API_KEY }));

  try {
    console.log("📅 Buscando partidos...");

    const now = new Date();
    const partidos = await obtenerPartidosDesdeOddsAPI(now, ODDS_API_KEY);

    if (!Array.isArray(partidos)) {
      throw new Error("La respuesta de partidos no es un array válido");
    }

    console.log(`📅 ${partidos.length} partidos encontrados para hoy ${now.toISOString().split('T')[0]}`);

    for (const partido of partidos) {
      try {
        const enriquecido = await enriquecerPartidoConAPIFootball(partido, API_FOOTBALL_KEY);
        if (!enriquecido) continue;

        const prompt = construirPromptIA(enriquecido);
        const iaResponse = await openai.createChatCompletion({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }]
        });

        const pick = JSON.parse(iaResponse.data.choices[0].message.content);

        const ev = calcularEV(enriquecido, pick);
        const nivel = clasificarPickPorEV(ev);

        if (!nivel) continue;

        const mensajeVIP = construirMensajeVIP(enriquecido, pick, ev, nivel);
        const mensajeFREE = construirMensajeFree(enriquecido, pick);

        if (nivel !== '📄 Informativo') {
          await enviarTelegram(mensajeVIP, TELEGRAM_GROUP_ID, TELEGRAM_BOT_TOKEN);
        } else {
          await enviarTelegram(mensajeFREE, TELEGRAM_CHANNEL_ID, TELEGRAM_BOT_TOKEN);
        }

        await guardarPickSupabase(supabase, enriquecido, pick, ev, nivel);

        await delay(1000);
      } catch (error) {
        console.error("⚠️ Error procesando partido:", error.message);
      }
    }

    return {
      statusCode: 200,
      body: "Proceso completado correctamente."
    };
  } catch (error) {
    console.error("❌ Error general en la función:", error.message);
    return {
      statusCode: 500,
      body: `Error general: ${error.message}`
    };
  }
};

// 🧩 FUNCIONES AUXILIARES SIMPLIFICADAS PARA ILUSTRACIÓN
async function obtenerPartidosDesdeOddsAPI(date, apiKey) {
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${apiKey}&regions=eu&markets=totals,spreads,h2h&oddsFormat=decimal`);
    if (!res.ok) throw new Error("Fallo la solicitud a OddsAPI");
    const data = await res.json();
    return data.filter(p => partidoEnRango(p.commence_time));
  } catch (err) {
    console.error("❌ Error en OddsAPI:", err.message);
    return [];
  }
}

function partidoEnRango(hora) {
  const ahora = new Date();
  const inicio = new Date(hora);
  const minutos = (inicio - ahora) / 60000;
  return minutos >= 45 && minutos <= 55;
}

async function enriquecerPartidoConAPIFootball(partido, apiKey) {
  try {
    // Aquí irían todas las llamadas a API-Football para alineaciones, árbitro, historial, clima...
    return {
      ...partido,
      liga: "España - La Liga",
      equipos: `${partido.home_team} vs. ${partido.away_team}`,
      fixture_id: partido.id // Usar el ID real que venga desde OddsAPI
    };
  } catch (err) {
    console.error("❌ Error enriqueciendo partido:", err.message);
    return null;
  }
}

function construirPromptIA(info) {
  return `Genera un JSON con análisis gratuito y VIP para el partido ${info.equipos} de la liga ${info.liga}. Incluye: análisis_gratuito, análisis_vip, apuesta, apuestas_extra, frase_motivacional.`;
}

function calcularEV(info, pick) {
  return Math.floor(Math.random() * 41); // Simulación de EV
}

function clasificarPickPorEV(ev) {
  if (ev >= 40) return '🟣 Ultra Elite';
  if (ev >= 30) return '🎯 Élite Mundial';
  if (ev >= 20) return '🥈 Avanzado';
  if (ev >= 15) return '🥉 Competitivo';
  if (ev >= 10) return '📄 Informativo';
  return null;
}

function construirMensajeVIP(info, pick, ev, nivel) {
  return `🎯 PICK NIVEL: ${nivel}\n${info.liga}\n${info.equipos}\nHora: Comienza en 50 min\nApuesta sugerida: ${pick.apuesta}\nEV: +${ev}%\n${pick.analisis_vip}\n${pick.apuestas_extra}`;
}

function construirMensajeFree(info, pick) {
  return `📡 RADAR DE VALOR\n${info.liga}\n${info.equipos}\nHora: Comienza en 50 min\n${pick.analisis_gratuito}\n${pick.frase_motivacional}\nÚnete al VIP gratis por 15 días ➜ @punterxpicks`;
}

async function enviarTelegram(mensaje, chatId, token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: mensaje })
    });
    if (!res.ok) throw new Error("Fallo envío Telegram");
  } catch (err) {
    console.error("📵 Telegram error:", err.message);
  }
}

async function guardarPickSupabase(supabase, info, pick, ev, nivel) {
  try {
    const { error } = await supabase.from("picks_historicos").insert({
      evento: `${info.equipos}`,
      analisis: pick.analisis_vip,
      apuesta: pick.apuesta,
      tipo_pick: nivel,
      liga: info.liga,
      equipos: info.equipos,
      ev: ev,
      probabilidad: null,
      nivel: nivel,
      timestamp: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("❌ Supabase error:", err.message);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
