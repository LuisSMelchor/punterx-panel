// 🔁 autopick-test.js
const crypto = require("crypto");

exports.handler = async function (event, context) {
  console.log("🚀 Ejecutando autopick-test.js");

  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  try {
    const response = await fetch("https://v3.football.api-sports.io/fixtures?date=2025-08-01&timezone=America/Mexico_City", {
      headers: {
        "x-apisports-key": API_KEY
      }
    });

    const json = await response.json();
    const game = json.response?.[0];

    if (!game) {
      return { statusCode: 404, body: "No se encontró partido para hoy." };
    }

    const home = game.teams.home.name;
    const away = game.teams.away.name;
    const league = game.league.name;
    const eventDate = game.fixture.date.split("T")[0];
    const odds = "1.80"; // Puedes automatizar esto luego con mercado/linemaker

    const match = `${home} vs ${away} (${league})`;
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac("sha256", SECRET).update(timestamp).digest("hex");

    const body = {
      authCode: "PunterX2025",
      honeypot: "",
      timestamp,
      signature,
      sport: "Fútbol",
      event: match,
      date: eventDate,
      bettype: "Más de 2.5 goles",
      odds,
      confidence: "Media",
      brief: `${home} y ${away} se enfrentan hoy. Se espera un juego abierto con opciones de gol.`,
      detailed: `Ambos equipos han promediado más de 2 goles por partido en sus últimos encuentros. ${home} tiene una ofensiva fuerte en casa, mientras que ${away} suele dejar espacios en defensa.`,
      alternatives: "Ambos anotan",
      bookie: "Bet365 / Pinnacle",
      value: "Línea mal ajustada según estadísticas recientes.",
      timing: "Ideal para jugar 1h antes del inicio.",
      notes: "Revisar alineaciones antes de apostar."
    };

    const result = await fetch(PANEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PX-Signature": signature
      },
      body: JSON.stringify(body)
    });

    const responseText = await result.text();
    console.log("✅ Resultado del envío:", responseText);

    return {
      statusCode: 200,
      body: `✅ Pick de prueba enviado: ${match} | Resultado: ${responseText}`,
    };
  } catch (error) {
    console.error("❌ Error en autopick-test.js:", error);
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`,
    };
  }
};
