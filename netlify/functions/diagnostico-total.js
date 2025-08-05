
// diagnostico-total.js FINAL - Versión con métricas y sin envío de mensajes

const fetch = globalThis.fetch;
const { createClient } = require("@supabase/supabase-js");

exports.handler = async () => {
  const resultados = [];

  // Verificar variables de entorno
  const requiredVars = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "API_FOOTBALL_KEY",
    "OPENAI_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHANNEL_ID",
    "TELEGRAM_GROUP_ID",
    "ODDS_API_KEY"
  ];
  const missingVars = requiredVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0) {
    resultados.push("❌ Faltan variables de entorno: " + missingVars.join(", "));
    return { statusCode: 500, body: resultados.join("\n") };
  } else {
    resultados.push("✅ Todas las variables necesarias están cargadas.");
  }

  // Inicializar Supabase
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const tabla = "picks_historicos";
  const columnasNecesarias = ["evento", "analisis", "apuesta", "tipo_pick"];

  try {
    const { data: estructura, error: errorEstructura } = await supabase.from(tabla).select("*").limit(1);
    if (errorEstructura) throw errorEstructura;

    const columnas = estructura && estructura.length > 0 ? Object.keys(estructura[0]) : [];
    const faltantes = columnasNecesarias.filter((col) => !columnas.includes(col));

    if (faltantes.length > 0) {
      resultados.push("❌ Error en test Supabase: faltan columnas: " + faltantes.join(", "));
    } else {
      // Insertar, leer y borrar
      const prueba = {
        evento: "Prueba Diagnóstico",
        analisis: "Este es un análisis de prueba",
        apuesta: "Over 2.5",
        tipo_pick: "diagnostico"
      };
      const insert = await supabase.from(tabla).insert([prueba]);
      const read = await supabase.from(tabla).select("*").eq("evento", "Prueba Diagnóstico").single();
      const del = await supabase.from(tabla).delete().eq("evento", "Prueba Diagnóstico");

      if (insert.error || read.error || del.error) {
        resultados.push("❌ Error en test Supabase: " + (insert.error?.message || read.error?.message || del.error?.message));
      } else {
        resultados.push("✅ Supabase insertó, leyó y borró correctamente.");
      }
    }
  } catch (err) {
    resultados.push("❌ Error general Supabase: " + err.message);
  }

  // API-FOOTBALL: consumo de llamadas
  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY },
    });
    const json = await res.json();
    const used = json?.response?.requests?.current || 0;
    resultados.push(`✅ API-Football activo. Llamadas hoy: ${used}`);
  } catch (err) {
    resultados.push("❌ Error en API-Football: " + err.message);
  }

  // OddsAPI
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports`, {
      headers: { "x-api-key": process.env.ODDS_API_KEY },
    });
    const headers = Object.fromEntries(res.headers.entries());
    const used = headers["x-requests-used"] || "desconocido";
    const remaining = headers["x-requests-remaining"] || "desconocido";
    resultados.push(`✅ OddsAPI activo. Llamadas usadas este mes: ${used} / restantes: ${remaining}`);
  } catch (err) {
    resultados.push("❌ Error en OddsAPI: " + err.message);
  }

  // OpenAI
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    if (res.ok) {
      resultados.push("✅ OpenAI conectado correctamente.");
    } else {
      resultados.push("❌ Error en OpenAI: " + (await res.text()));
    }
  } catch (err) {
    resultados.push("❌ Error en OpenAI: " + err.message);
  }

  return {
    statusCode: 200,
    body: resultados.join("\n"),
  };
};
