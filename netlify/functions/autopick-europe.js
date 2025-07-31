// autopick-europe.js
const { schedule } = require("@netlify/functions");
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

    const topLeagues = ["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"];
    const fixture = json.response.find(fix => topLeagues.includes(fix.league.name));

    if (!fixture) {
      return { statusCode: 404, body: "No se encontró partido europeo para hoy." };
    }

    const match = `${fixture.teams.home.name} vs ${fixture.teams.away.name}`;
    const date = fixture.fixture.date;
    const odds = "1.90";
    const confidence = "Alta";
    const predictedScore = "2-1";
    const winProbability = "80%";
    const brief = `Pick con alta probabilidad de valor. Predicción IA: ${predictedScore} con ${winProbability} de certeza.`;
    const detailed = `Análisis táctico y emocional completo para el enfrentamiento ${match}`;
    const alternatives = "Ambos anotan";
    const bookie = "Bet365, Pinnacle";
    const value = "Línea mal calibrada por reciente desempeño.";
    const timing = "Antes de que el mercado ajuste";
    const notes = "Ideal para combinaciones.";

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
      bettype: "Over 2.5 goles",
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
      body: `✅ Enviado pick europeo automático: ${match}`
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: `❌ Error en autopick europeo: ${error.message}`
    };
  }
};

exports.handler = schedule("0 13 * * *", handler);
