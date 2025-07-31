const crypto = require("crypto");

exports.handler = async function () {
  try {
    // ✅ Validar variables de entorno
    const API_KEY = process.env.API_FOOTBALL_KEY;
    const SECRET = process.env.PUNTERX_SECRET;
    const PANEL_URL = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

    if (!API_KEY || !SECRET) {
      console.error("❌ Variables de entorno faltantes");
      return { statusCode: 500, body: "❌ Error: Variables de entorno no definidas" };
    }

    // ✅ Obtener fecha actual en formato YYYY-MM-DD
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    console.log(`📅 Fecha de hoy: ${today}`);

    // ✅ Obtener partido de fútbol del día
    const apiUrl = `https://v3.football.api-sports.io/fixtures?date=${today}`;
    const response = await fetch(apiUrl, {
      headers: {
        "x-apisports-key": API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`API-Football responded with ${response.status} ${response.statusText}`);
    }

    const json = await response.json();

    if (json.errors && Object.keys(json.errors).length) {
      console.error("❌ API-Football devolvió errores:", json.errors);
      return { statusCode: 500, body: "❌ Error en API-Football" };
    }

    const game = json.response?.[0];

    if (!game) {
      console.log(`⚠️ No se encontró partido para hoy: ${today}`);
      return { statusCode: 404, body: `⚠️ No hay partidos para hoy: ${today}` };
    }

    const home = game.teams?.home?.name || "Equipo local";
    const away = game.teams?.away?.name || "Equipo visitante";
    const league = game.league?.name || "Liga desconocida";

    const match = `${home} vs ${away} (${league})`;

    // ✅ Preparar payload con firma
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac("sha256", SECRET).update(timestamp).digest("hex");

    const payload = {
      authCode: "PunterX2025",
      sport: "Fútbol",
      match,
      pick: `Gana ${home}`,
      odds: "1.80",
      timestamp,
      signature,
      origin: "https://punterx-panel-vip.netlify.app",
      honeypot: ""
    };

    // ✅ Enviar a función send
    const result = await fetch(PANEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const resultText = await result.text();

    console.log("📨 Resultado del envío al panel:", resultText);

    if (!result.ok) {
      throw new Error(`❌ Error enviando al panel: ${result.status} ${result.statusText}`);
    }

    return {
      statusCode: 200,
      body: `✅ Pick enviado: ${match}\n📨 Resultado: ${resultText}`,
    };

  } catch (error) {
    console.error("❌ Error en autopick-europe-test:", error);
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`,
    };
  }
};
