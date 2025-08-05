
const fetch = globalThis.fetch || require("node-fetch");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async () => {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
  const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  const resultados = [];

  // Verificación de variables necesarias
  const variablesNecesarias = [
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID,
    TELEGRAM_GROUP_ID,
    OPENAI_API_KEY,
    API_FOOTBALL_KEY,
    ODDS_API_KEY,
    SUPABASE_URL,
    SUPABASE_KEY,
  ];

  if (variablesNecesarias.every(Boolean)) {
    resultados.push("✅ Todas las variables necesarias están cargadas.");
  } else {
    resultados.push("❌ Faltan variables necesarias en el entorno.");
  }

  // Supabase prueba: insertar, leer y borrar
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const insert = await supabase.from("picks_historicos").insert([{
      liga: "Test",
      equipos: "Equipo A vs Equipo B",
      analisis: "Diagnóstico IA",
      apuesta: "Over 2.5",
      ev: 20,
      probabilidad: 60,
      tipo_pick: "Diagnóstico",
      nivel: "Test",
      creado_en: new Date().toISOString()
    }]);

    if (insert.error) throw insert.error;

    const read = await supabase.from("picks_historicos").select("*").eq("liga", "Test");
    const del = await supabase.from("picks_historicos").delete().eq("liga", "Test");

    if (read.error || del.error) throw read.error || del.error;

    resultados.push("✅ Supabase insertó, leyó y borró correctamente.");
  } catch (err) {
    resultados.push(`❌ Error en test Supabase: ${err.message}`);
  }

  // API-Football
  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": API_FOOTBALL_KEY }
    });
    const data = await res.json();
    const used = data.response.requests.current;
    const limit = data.response.requests.limit_day;
    resultados.push(`✅ API-Football activo. Llamadas hoy: ${used} / Límite diario: ${limit} / Restantes: ${limit - used}`);
  } catch {
    resultados.push("❌ Error en API-Football.");
  }

  // OddsAPI
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`);
    const headers = res.headers;
    const used = headers.get("x-requests-used");
    const remaining = headers.get("x-requests-remaining");
    resultados.push(`✅ OddsAPI activo. Llamadas usadas este mes: ${used} / restantes: ${remaining}`);
  } catch {
    resultados.push("❌ Error en OddsAPI.");
  }

  // OpenAI
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
    });
    if (res.ok) {
      resultados.push("✅ OpenAI conectado correctamente.");
    } else {
      resultados.push("❌ Error en conexión con OpenAI.");
    }
  } catch {
    resultados.push("❌ Error en conexión con OpenAI.");
  }

  // Validar clave Telegram sin enviar mensaje
  if (TELEGRAM_BOT_TOKEN?.startsWith("8") && TELEGRAM_BOT_TOKEN.length > 40) {
    resultados.push("✅ Telegram: Clave válida y funcional (sin enviar mensajes).");
  } else {
    resultados.push("❌ Telegram: Clave inválida o mal configurada.");
  }

  return {
    statusCode: 200,
    body: resultados.join("\n")
  };
};
