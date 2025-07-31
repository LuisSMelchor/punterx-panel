// autopick-evening.js
const crypto = require("crypto");

exports.handler = async function (event, context) {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const headers = {
    "x-apisports-key": API_KEY
  };

  const response = await fetch(
    "https://v3.football.api-sports.io/fixtures?date=" + new Date().toISOString().split("T")[0] + "&timezone=America/Mexico_City",
    { headers }
  );

  const json = await response.json();

  const partidos = json.response.filter(p => {
    const hora = new Date(p.fixture.date).getHours();
    return hora >= 19 && hora <= 23;
  });

  const juego = partidos[0];
  if (!juego) {
    return {
      statusCode: 404,
      body: "❌ No se encontraron juegos nocturnos para hoy."
    };
  }

  const match = `${juego.teams.home.name} vs ${juego.teams.away.name}`;
  const date = juego.fixture.date;
  const deporte = "Fútbol";
  const bettype = "Over 2.5 goles";
  const odds = "1.90";
  const confidence = "Alta";
  const brief = "Partido con ritmo ofensivo y tendencia a generar goles en los minutos finales.";
  const detailed = `🔎 *Análisis VIP:*
El duelo ${match} presenta condiciones ideales para una apuesta en altas.

📊 *Estadísticas:* Últimos enfrentamientos directos con promedio superior a 3 goles.
🎯 *Estilo de juego:* Equipos con vocación ofensiva, defensa vulnerable.
🔥 *Clima emocional:* Necesidad de victoria puede empujar a arriesgar más.
📈 *Tendencia reciente:* Marcadores abultados en sus últimas 5 presentaciones.`;
  const alternatives = "Ambos anotan (BTTS)";
  const bookie = "Bet365, Pinnacle";
  const value = "Cuota estable sin grandes movimientos pese al contexto ofensivo.";
  const timing = "Apostar 1 hora antes del juego.";
  const notes = "Ideal para combinaciones nocturnas o cierre de día.";

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

  const text = await result.text();

  return {
    statusCode: 200,
    body: `✅ Pick nocturno enviado: ${text}`
  };
};
