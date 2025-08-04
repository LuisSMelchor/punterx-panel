// /netlify/functions/diagnostico/diagnostico-total-avanzado.js

import { createClient } from '@supabase/supabase-js';

const fetch = globalThis.fetch;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function handler() {
  const resumen = [];
  let todoOk = true;

  // 1. Verificar variables de entorno
  if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_KEY || !API_FOOTBALL_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) {
    resumen.push("❌ Faltan variables de entorno necesarias.");
    todoOk = false;
  } else {
    resumen.push("✅ Todas las variables necesarias están cargadas.");
  }

  // 2. Probar conexión Supabase con inserción + lectura + borrado
  try {
    const insertRes = await supabase.from("picks_historicos").insert([{
      equipo_local: "Equipo A",
      equipo_visitante: "Equipo B",
      liga: "Liga Test",
      valor_esperado: 25,
      es_prueba: true,
      mensaje: "Este es un mensaje de prueba",
      hora_local: new Date().toISOString().replace("T", " ").slice(0, 19)
    }]);

    if (insertRes.error) throw insertRes.error;

    const { data } = await supabase.from("picks_historicos").select("*").eq("es_prueba", true);
    if (!data.length) throw new Error("No se pudo leer el pick de prueba");

    await supabase.from("picks_historicos").delete().eq("es_prueba", true);

    resumen.push("✅ Supabase insertó, leyó y borró correctamente.");
  } catch (e) {
    resumen.push("❌ Error en test Supabase: " + e.message);
    todoOk = false;
  }

  // 3. Probar API-Football
  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: { "x-apisports-key": API_FOOTBALL_KEY }
    });
    const json = await res.json();
    if (json.errors?.token) throw new Error("Token inválido de API-Football");
    resumen.push("✅ API-Football activo y respondiendo.");
  } catch (e) {
    resumen.push("❌ Error en API-Football: " + e.message);
    todoOk = false;
  }

  // 4. Probar conexión OpenAI (solo encabezado)
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: {
        "Authorization": "Bearer " + OPENAI_KEY,
        "Content-Type": "application/json"
      }
    });
    if (res.status !== 200) throw new Error("Respuesta no válida de OpenAI");
    resumen.push("✅ OpenAI conectado correctamente.");
  } catch (e) {
    resumen.push("❌ Error en OpenAI: " + e.message);
    todoOk = false;
  }

  // 5. Enviar mensaje de prueba a Telegram (opcional)
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHANNEL_ID,
        text: "📡 Diagnóstico automático completado con éxito desde Netlify. Todo funciona correctamente ✅"
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    resumen.push("✅ Telegram recibió mensaje de prueba.");
  } catch (e) {
    resumen.push("❌ Error enviando a Telegram: " + e.message);
    todoOk = false;
  }

  return {
    statusCode: 200,
    body: resumen.join("\n")
  };
}
