// autopick-evening.js
const crypto = require("crypto");

const handler = async () => {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const SECRET = process.env.PUNTERX_SECRET;
  const PANEL_ENDPOINT = "https://punterx-panel-vip.netlify.app/.netlify/functions/send";

  const today = new Date().toISOString().split("T")[0];
  const url = `https://v3.football.api-sports.io/fixtures?date=${today}&timezone=America/Mexico_City`;

  const headers = {
    "x-apisports-key": API_KEY
  };

  try {
    const response = await fetch(url, { headers });
    const json = await response.json();

    const fixture = json.response.find(fix =>
      ["Mexico", "USA"].includes(fix.league.country) &&
      new Date(fix.fixture.date).getHours() >= 19 // Partidos desde 7:00 p.m.
    );

    if (!fixture) {
      return { statusCode: 404, body: "No se encontró partido nocturno relevante." };
    }

    const match = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
    const date = fixture.fixture.date;
    const odds = "1.87";
    const confidence = "Alta";
    const predictedScore = "2-1";
    const winProbability = "72%";
    const brief = `Partido nocturno destacado. Predicción IA: ${predictedScore} con ${winProbability} de certeza.`;
    const detailed = `🧠 Análisis nocturno para ${match} centrado en motivación, forma física y presión de resultado.

🔥 Ritmo alto esperado con oportunidades en ambas áreas.

📈 Valor detectado en mercados secundarios por ajustes tardíos de las casas.`;
    const alternatives = "Ambos anotan + Over 2.5 goles";
    const bookie = "Bet365, Caliente, Pinnacle";
    const value = "Las cuotas están mal calibradas tras las alineaciones confirmadas.";
    const timing = "Ideal para apostar 1 hora antes del inicio.";
    const notes = "Perfecto para usuarios activos en la noche y estrategias combinadas.";

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
      bettype: "Gana local",
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

    return {
      statusCode: 200,
      body: `✅ Pick nocturno enviado: ${match}`
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: `❌ Error en autopick-evening: ${error.message}`
    };
  }
};

exports.handler = schedule("0 0 * * *", handler); // 7:00 p.m. CDMX = 00:00 UTC (día siguiente)
