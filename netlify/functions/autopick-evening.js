// 🔁 autopick-evening.js
const crypto = require("crypto");

exports.handler = async function (event, context) {
  console.log("🚀 Ejecutando autopick-evening.js");

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
    const game = json.response?.[2]; // Puedes ajustar el índice según el tipo de partido nocturno que quieras

    if (!game) {
      return { statusCode: 404, body: "No se encontró partido para hoy." };
    }

    const home = game.teams.home.name;
    const away = game.teams.away.name;
    const league = game.league.name;
    const eventDate = game.fixture.date.split("T")[0];
    const odds = "1.90";

    const match = `${home} vs ${away} (${league})`;
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac("sha256", SECRET).update(timestamp).digest("hex");

    const basicBody = {
      authCode: "PunterX2025",
      honeypot: "",
      timestamp,
      signature,
      sport: "Fútbol",
      event: match,
      date: eventDate,
      bettype: "Over 2.5 goles",
      odds,
      confidence: "Media",
      brief: `Cierre del día con un duelo abierto entre ${home} y ${away}.`,
      detailed: "",
      alternatives: "",
      bookie: "",
      value: "",
      timing: "",
      notes: ""
    };

    const vipBody = {
      ...basicBody,
      detailed: `${home} suele cerrar fuerte en casa, y ${away} viene con tendencia a partidos abiertos. Ambos han tenido altas en 3 de sus últimos 4 juegos.`,
      alternatives: "Ambos anotan y over 2.5",
      bookie: "Pinnacle / Codere",
      value: "Cuota desfasada por baja reciente de uno de los equipos.",
      timing: "Jugar antes de que caiga la cuota en las últimas horas.",
      notes: "Ideal para bancas rápidas, cierre del día con valor."
    };

    const sendBasic = await fetch(PANEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PX-Signature": signature
      },
      body: JSON.stringify(basicBody)
    });

    const basicResult = await sendBasic.text();
    console.log("✅ Enviado al canal gratuito:", basicResult);

    const sendVIP = await fetch(PANEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PX-Signature": signature
      },
      body: JSON.stringify(vipBody)
    });

    const vipResult = await sendVIP.text();
    console.log("✅ Enviado al grupo VIP:", vipResult);

    return {
      statusCode: 200,
      body: `✅ Pick evening enviado. Canal: ${basicResult} | VIP: ${vipResult}`
    };

  } catch (error) {
    console.error("❌ Error en autopick-evening.js:", error);
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`
    };
  }
};
