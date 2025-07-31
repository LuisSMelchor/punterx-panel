// 🔁 autopick-pre-mx.js
const crypto = require("crypto");

exports.handler = async function (event, context) {
  console.log("🚀 Ejecutando autopick-pre-mx.js");

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
    const game = json.response?.[1]; // Cambia el índice si quieres otro evento diferente al europeo

    if (!game) {
      return { statusCode: 404, body: "No se encontró partido para hoy." };
    }

    const home = game.teams.home.name;
    const away = game.teams.away.name;
    const league = game.league.name;
    const eventDate = game.fixture.date.split("T")[0];
    const odds = "1.85";

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
      bettype: "Ambos anotan",
      odds,
      confidence: "Alta",
      brief: `${home} y ${away} tienen estadísticas ofensivas fuertes y defensas vulnerables.`,
      detailed: "",
      alternatives: "",
      bookie: "",
      value: "",
      timing: "",
      notes: ""
    };

    const vipBody = {
      ...basicBody,
      detailed: `${home} ha anotado en 9 de sus últimos 10 partidos. ${away} ha recibido goles en 8 de sus últimos 10. Esta combinación es ideal para esperar goles de ambos lados.`,
      alternatives: "Over 2.5",
      bookie: "1XBET / Bet365",
      value: "Comparando probabilidades y goles esperados, esta línea está ligeramente inflada.",
      timing: "Jugar 30 min antes del inicio con alineaciones confirmadas.",
      notes: "Verifica condiciones climatológicas si es juego en césped natural."
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
      body: `✅ Pick medio día enviado. Canal: ${basicResult} | VIP: ${vipResult}`
    };

  } catch (error) {
    console.error("❌ Error en autopick-pre-mx.js:", error);
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`
    };
  }
};
