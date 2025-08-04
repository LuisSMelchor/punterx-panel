// diagnostico-total.js

const fetch = globalThis.fetch;

exports.handler = async function () {
  const requiredVars = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "API_FOOTBALL_KEY",
    "OPENAI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID",
    "TELEGRAM_GROUP_ID",
    "PUNTERX_SECRET"
  ];

  const missingVars = requiredVars.filter((key) => !process.env[key]);
  const resultados = [];

  if (missingVars.length > 0) {
    resultados.push(`❌ Variables faltantes: ${missingVars.join(", ")}`);
  } else {
    resultados.push("✅ Todas las variables necesarias están cargadas.");
  }

  // 🔌 Probar Supabase
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/picks_historicos?select=id&limit=1`, {
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`
      }
    });
    const json = await res.json();
    if (Array.isArray(json)) {
      resultados.push("✅ Supabase conectado correctamente.");
    } else {
      resultados.push("❌ Supabase: respuesta inesperada.");
    }
  } catch (e) {
    resultados.push("❌ Error al conectar con Supabase: " + e.message);
  }

  // ⚽ Probar API-Football
  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY }
    });
    const json = await res.json();
    if (json?.response?.requests?.current !== undefined) {
      resultados.push("✅ API-Football activo y respondiendo.");
    } else {
      resultados.push("❌ API-Football: respuesta inesperada.");
    }
  } catch (e) {
    resultados.push("❌ Error al conectar con API-Football: " + e.message);
  }

  // 🤖 Probar OpenAI
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });
    const json = await res.json();
    if (Array.isArray(json.data)) {
      resultados.push("✅ OpenAI conectado correctamente.");
    } else {
      resultados.push("❌ OpenAI: respuesta inesperada.");
    }
  } catch (e) {
    resultados.push("❌ Error al conectar con OpenAI: " + e.message);
  }

  return {
    statusCode: 200,
    body: resultados.join("\n")
  };
};
