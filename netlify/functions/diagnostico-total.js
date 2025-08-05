
const fetch = globalThis.fetch;
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async () => {
  const resultados = [];

  // Verificar variables
  const variables = [
    "SUPABASE_URL", "SUPABASE_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHANNEL_ID",
    "TELEGRAM_GROUP_ID", "API_FOOTBALL_KEY", "ODDS_API_KEY", "OPENAI_API_KEY"
  ];
  const faltantes = variables.filter(v => !process.env[v]);
  if (faltantes.length > 0) {
    resultados.push(`❌ Variables faltantes: ${faltantes.join(", ")}`);
  } else {
    resultados.push("✅ Todas las variables necesarias están cargadas.");
  }

  // Supabase test
  try {
    const testData = {
      equipos: "EquipoA vs EquipoB",
      liga: "Liga Test",
      hora: "23:59",
      analisis: "Test",
      apuesta: "Over 2.5",
      probabilidad: 0.5,
      ev: 0.3,
      tipo_pick: "test",
    };
    const insert = await supabase.from("picks_historicos").insert([testData]);
    if (insert.error) throw insert.error;

    const read = await supabase.from("picks_historicos").select("*").eq("tipo_pick", "test");
    if (read.error || read.data.length === 0) throw read.error;

    const remove = await supabase.from("picks_historicos").delete().eq("tipo_pick", "test");
    if (remove.error) throw remove.error;

    resultados.push("✅ Supabase insertó, leyó y borró correctamente.");
  } catch (e) {
    resultados.push(`❌ Error en test Supabase: ${e.message}`);
  }

  // API-Football test
  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": API_FOOTBALL_KEY }
    });
    const json = await res.json();
    const used = json?.response?.requests?.current;
    resultados.push(`✅ API-Football activo. Llamadas hoy: ${used || "desconocido"}`);
  } catch (e) {
    resultados.push(`❌ Error en API-Football: ${e.message}`);
  }

  // OddsAPI test
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`);
    const remaining = res.headers.get("x-requests-remaining");
    const used = res.headers.get("x-requests-used");
    resultados.push(`✅ OddsAPI activo. Llamadas usadas este mes: ${used || "desconocido"} / restantes: ${remaining || "desconocido"}`);
  } catch (e) {
    resultados.push(`❌ Error en OddsAPI: ${e.message}`);
  }

  // OpenAI test
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` }
    });
    if (res.ok) {
      resultados.push("✅ OpenAI conectado correctamente.");
    } else {
      throw new Error("Respuesta no OK");
    }
  } catch (e) {
    resultados.push(`❌ Error en OpenAI: ${e.message}`);
  }

  // Telegram canal
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHANNEL_ID, text: "✅ Diagnóstico: mensaje enviado al canal gratuito." }),
    });
    if (!res.ok) throw new Error("Respuesta no OK");
    resultados.push("✅ Envío al canal gratuito exitoso.");
  } catch (e) {
    resultados.push(`❌ Error al enviar al canal gratuito: ${e.message}`);
  }

  // Telegram grupo VIP
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_GROUP_ID, text: "✅ Diagnóstico: mensaje enviado al grupo VIP." }),
    });
    if (!res.ok) throw new Error("Respuesta no OK");
    resultados.push("✅ Envío al grupo VIP exitoso.");
  } catch (e) {
    resultados.push(`❌ Error al enviar al grupo VIP: ${e.message}`);
  }

  return {
    statusCode: 200,
    body: resultados.join("\n"),
  };
};
