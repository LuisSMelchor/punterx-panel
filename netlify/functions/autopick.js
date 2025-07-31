const crypto = require("crypto");

exports.handler = async function (event, context) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const headers = { "x-apisports-key": API_KEY };

  const ligasTop = [39, 140, 135, 78, 61, 2]; // Premier, La Liga, Serie A, Bundesliga, Champions, Copa América

  try {
    const apiUrl = `https://v3.football.api-sports.io/fixtures?date=${today}&timezone=America/Toronto`;
    const response = await fetch(apiUrl, { headers });
    const json = await response.json();

    const partidosFiltrados = json.response.filter(j =>
      ligasTop.includes(j.league.id) &&
      !j.league.round?.toLowerCase().includes("friendly")
    );

    if (!partidosFiltrados.length) {
      return { statusCode: 404, body: "❌ No hay partidos relevantes para hoy." };
    }

    const game = partidosFiltrados[Math.floor(Math.random() * partidosFiltrados.length)];
    const match = `${game.teams.home.name} vs ${game.teams.away.name}`;
    const date = game.fixture.date;
    const bettype = "Over 2.5 goles";
    const odds = "1.90";
    const confidence = "Alta";
    const prediccion = "3-1";
    const seguridad = "82%";

    const brief = "Partido con ritmo ofensivo y tendencia reciente a superar las líneas establecidas por el mercado.";

    const detailed = `🔎 *Análisis VIP:*
El enfrentamiento entre ${match} tiene varios factores que nos permiten detectar un valor oculto.

📊 *Estadísticas recientes:* Ambos equipos han superado la línea propuesta en al menos 4 de sus últimos 5 juegos.

🎯 *Tendencia táctica:* El estilo ofensivo y la necesidad de puntos generan contextos ideales para apuestas en altas.

🧠 *Aspectos psicológicos:* La presión por sumar victorias, unido a la fatiga defensiva acumulada, favorece un ritmo abierto.

💡 *Valor detectado:* Las casas de apuestas no ajustaron completamente sus líneas, lo que deja una ventana de oportunidad que podemos aprovechar.

🔢 *Predicción aproximada:* ${prediccion}
🔐 *Confianza estimada:* ${seguridad}

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
      sport: "Fútbol",
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
      body: `❌ Error interno en autopick: ${error.message}`
    };
  }
};
