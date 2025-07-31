// 🔁 autopick-europe.js
const crypto = require("crypto");
const { buscarPartidoPrioritario } = require("./utils/filtrarPartido");

exports.handler = async function (event, context) {
  console.log("🚀 Ejecutando autopick-europe.js");

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

    // ⚽ Buscar partido en el rango 07:00 - 12:00 CDMX, priorizando ligas europeas
    const game = buscarPartidoPrioritario(json.response, "07:00", "12:00");

    if (!game) {
      return { statusCode: 404, body: "No se encontró partido prioritario para este rango." };
    }

    const match = `${game.teams.home.name} vs ${game.teams.away.name} (${game.league.name})`;
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac("sha256", SECRET).update(timestamp).digest("hex");

    const body = {
      authCode: "PunterX2025",
      honeypot: "",
      timestamp,
      signature,
      sport: "Fútbol",
      event: match,
      date: "-",
      bettype: "-",
      odds: "1.80",
      confidence: "-",
      brief: "-",
      detailed: "-",
      alternatives: "-",
      bookie: "-",
      value: "-",
      timing: "-",
      notes: "-"
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
      body: `✅ Pick europeo enviado: ${match} | Resultado: ${responseText}`,
    };
  } catch (error) {
    console.error("❌ Error en autopick-europe:", error);
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`,
    };
  }
};
