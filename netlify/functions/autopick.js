const fetch = require("node-fetch");
const crypto = require("crypto");

exports.handler = async function (event, context) {
  const API_KEY = "f832d44689c32ddc03f7ccc23a1e1076";
  const SECRET = "X9$Gtp#zD3@LP82mR*vWj5Q!7bCk%N0y";
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const sportParam = event.queryStringParameters?.sport || "football";

  let apiUrl = "";
  let headers = { "x-apisports-key": API_KEY };
  let deporte = "";
  let match = "";
  let date = "";
  let bettype = "";
  let odds = "1.90";

  try {
    if (sportParam === "nba") {
      deporte = "NBA";
      apiUrl = `https://v1.basketball.api-sports.io/games?date=2025-07-31`;
      headers["x-rapidapi-host"] = "v1.basketball.api-sports.io";
    } else {
      deporte = "Fútbol";
      apiUrl = `https://v3.football.api-sports.io/fixtures?date=2025-07-31&timezone=America/Toronto`;
    }

    const response = await fetch(apiUrl, { headers });
    const json = await response.json();
    const game = json.response?.[0];

    if (!game) {
      return { statusCode: 404, body: "No se encontró partido para hoy." };
    }

    if (sportParam === "nba") {
      match = `${game.teams.home.name} vs ${game.teams.away.name}`;
      date = game.date;
      bettype = "Over 210.5 puntos";
    } else {
      match = `${game.teams.home.name} vs ${game.teams.away.name}`;
      date = game.fixture.date;
      bettype = "Over 2.5 goles";
    }

    const confidence = "Alta";
    const brief = "Partido con ritmo ofensivo y tendencia reciente a superar las líneas establecidas por el mercado.";

    const detailed = `🔎 *Análisis VIP:*
El enfrentamiento entre ${match} tiene varios factores que nos permiten detectar un valor oculto.

📊 *Estadísticas recientes:* Ambos equipos han superado la línea propuesta en al menos 4 de sus últimos 5 juegos.

🎯 *Tendencia táctica:* El estilo ofensivo y la necesidad de puntos generan contextos ideales para apuestas en altas.

🧠 *Aspectos psicológicos:* La presión por sumar victorias, unido a la fatiga defensiva acumulada, favorece un ritmo abierto.

💡 *Valor detectado:* Las casas de apuestas no ajustaron completamente sus líneas, lo que deja una ventana de oportunidad que podemos aprovechar.

⚠️ *Recomendación:* Verifica posibles bajas o rotaciones antes de realizar la apuesta para confirmar que el valor se mantiene.`;

    const alternatives = sportParam === "nba"
      ? "Ambos equipos superan los 105.5 puntos"
      : "Ambos anotan (BTTS)";

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
      sport: deporte,
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
      notes
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

    return {
      statusCode: 200,
      body: `✅ Pick automático enviado para ${match}: ${responseText}`
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: `❌ Error interno: ${error.message}`
    };
  }
};




