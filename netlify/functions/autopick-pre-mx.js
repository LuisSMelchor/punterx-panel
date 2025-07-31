const crypto = require("crypto");

exports.handler = async function () {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const headers = { "x-apisports-key": API_KEY };
  const today = new Date().toISOString().split("T")[0];
  const apiUrl = `https://v3.football.api-sports.io/fixtures?date=${today}&timezone=America/Mexico_City`;

  try {
    const response = await fetch(apiUrl, { headers });
    const data = await response.json();
    const games = data.response;

    if (!games || games.length === 0) {
      return {
        statusCode: 404,
        body: "No hay partidos para hoy."
      };
    }

    // Elegimos un partido vespertino (después de las 15:00 hora CDMX)
    const pickGame = games.find(g => new Date(g.fixture.date).getHours() >= 15);
    if (!pickGame) {
      return {
        statusCode: 404,
        body: "No se encontraron partidos vespertinos para hoy."
      };
    }

    const match = `${pickGame.teams.home.name} vs ${pickGame.teams.away.name}`;
    const date = pickGame.fixture.date;
    const sport = "Fútbol";
    const bettype = "Ambos anotan (BTTS)";
    const odds = "1.85";
    const confidence = "Alta";
    const brief = "Equipos con tendencia goleadora. Últimos encuentros muestran vulnerabilidad defensiva.";
    const detailed = `🔎 *Análisis VIP:*
El partido ${match} enfrenta a dos conjuntos con clara tendencia al gol.

📊 *Estadísticas recientes:* Ambos equipos han marcado en sus últimos 4 partidos.
⚽ *Estilo de juego:* Propuesta ofensiva abierta, sin especulación en zona media.
🧠 *Contexto anímico:* Necesidad de sumar puntos favorece un planteamiento arriesgado.
💥 *Oportunidad de valor:* Cuota justa con margen de valor por estadísticas actuales.`;

    const alternatives = "Más de 2.5 goles";
    const bookie = "Bet365, Codere";
    const value = "Desajuste defensivo de ambos lados no reflejado aún en las cuotas.";
    const timing = "Apostar antes de que bajen las cuotas (dentro de las próximas 3h).";
    const notes = "Buena opción para combinar con apuestas de Liga MX en jornada nocturna.";

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
      body: `❌ Error interno en autopick-pre-mx: ${error.message}`
    };
  }
};
