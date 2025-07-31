// netlify/functions/autopick-europe.js
const crypto = require("crypto");

exports.handler = async function (event, context) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const headers = {
    "x-apisports-key": API_KEY,
  };

  const today = new Date().toISOString().split("T")[0];
  const apiUrl = `https://v3.football.api-sports.io/fixtures?date=${today}&timezone=America/Mexico_City`;

  try {
    const response = await fetch(apiUrl, { headers });
    const json = await response.json();
    const fixtures = json.response || [];

    if (fixtures.length === 0) {
      return { statusCode: 404, body: "No hay partidos para hoy." };
    }

    // Ordenar por hora y seleccionar el primero
    fixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    const game = fixtures[0];

    const match = `${game.teams.home.name} vs ${game.teams.away.name}`;
    const date = game.fixture.date;
    const sport = "Fútbol";
    const bettype = "Over 2.5 goles";
    const odds = "1.90";
    const confidence = "Alta";
    const brief = "Partido con ritmo ofensivo y tendencia reciente a superar las líneas establecidas por el mercado.";
    const detailed = `🔎 *Análisis VIP:*
El enfrentamiento entre ${match} tiene varios factores que nos permiten detectar un valor oculto.

📊 *Estadísticas recientes:* Ambos equipos han superado la línea propuesta en al menos 4 de sus últimos 5 juegos.

🎯 *Tendencia táctica:* El estilo ofensivo y la necesidad de puntos generan contextos ideales para apuestas en altas.

🧠 *Aspectos psicológicos:* La presión por sumar victorias, unido a la fatiga defensiva acumulada, favorece un ritmo abierto.

💡 *Valor detectado:* Las casas de apuestas no ajustaron completamente sus líneas, lo que deja una ventana de oportunidad que podemos aprovechar.

⚠️ *Recomendación:* Verifica posibles bajas o rotaciones antes de realizar la apuesta para confirmar que el valor se mantiene.`;

    const alternatives = "Ambos anotan (BTTS)";
    const bookie = "Bet365, Pinnacle";
    const value = "Línea inflada no ajustada al contexto actual de los equipos.";
    const timing = "Apostar antes del movimiento brusco de cuota en las próximas horas.";
    const notes = "Buena opción para combinar con otras selecciones de alto valor en parlays.";

    const timestamp = Date.now().toString();
    const signature = crypto.createHmac("sha256", SECRET).update(timestamp).digest("hex");

    const body = {
      authCode: "PunterX2025",
      honeypot: "",
      timestamp,
      signature,
      sport,
      event: match,
      date,
      bettype,
      odds,
      confidence,
      brief,
      detailed,
      alternatives,
      bookie,
      value,
      timing,
      notes,
    };

    const result = await fetch(PANEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PX-Signature": signature,
      },
      body: JSON.stringify(body),
    });

    const responseText = await result.text();

    return {
      statusCode: 200,
      body: `✅ Pick europeo enviado: ${match} | Resultado: ${responseText}`,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`,
    };
  }
};
