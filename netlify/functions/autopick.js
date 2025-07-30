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
    const brief = "Partido con ritmo ofensivo y tendencia reciente a superar las líneas de puntos/goles.";
    const detailed = `🔐 *Análisis VIP:*
Este pick se apoya en el rendimiento reciente ofensivo de ambos equipos. ${match} presenta una oportunidad clara de valor.

Las estadísticas muestran que ambos equipos han superado esta línea en 4 de sus últimos 5 partidos. Además, la presión por sumar puntos y el estilo de juego abierto favorecen el Over.

💡 El mercado no ha ajustado completamente la línea, lo que representa una ventana de valor aprovechable.

⚠️ *Ojo:* Revisa alineaciones o descansos antes del inicio.`;
    const alternatives = sportParam === "nba" ? "Ambos equipos +105.5 puntos individuales" : "Ambos marcan (BTTS)";
    const bookie = "Bet365";
    const value = "El mercado no refleja totalmente la tendencia ofensiva reciente.";
    const timing = "Apostar antes del cierre de cuotas para mantener el valor.";
    const notes = "Ideal para combinar en parlays de alto valor o como apuesta principal si hay rotaciones mínimas.";

    // Construir cuerpo de datos
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

    // Enviar al endpoint de tu backend
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

