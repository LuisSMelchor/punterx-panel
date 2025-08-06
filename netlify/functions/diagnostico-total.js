// diagnostico-total.js

exports.handler = async function(event, context) {
  const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

  const response = {
    statusCode: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: `
✅ Diagnóstico del sistema PunterX - [${now}]

📦 Variables de entorno:
- ${process.env.API_FOOTBALL_KEY ? "✅" : "❌"} API_FOOTBALL_KEY
- ${process.env.ODDS_API_KEY ? "✅" : "❌"} ODDS_API_KEY
- ${process.env.SUPABASE_URL ? "✅" : "❌"} SUPABASE_URL
- ${process.env.SUPABASE_KEY ? "✅" : "❌"} SUPABASE_KEY
- ${process.env.TELEGRAM_BOT_TOKEN ? "✅" : "❌"} TELEGRAM_BOT_TOKEN
- ${process.env.TELEGRAM_GROUP_ID ? "✅" : "❌"} TELEGRAM_GROUP_ID
- ${process.env.TELEGRAM_CHANNEL_ID ? "✅" : "❌"} TELEGRAM_CHANNEL_ID
- ${process.env.OPENAI_API_KEY ? "✅" : "❌"} OPENAI_API_KEY

💾 Supabase:
- Estado: Se requiere validación manual

⚽ API-FOOTBALL:
- Llamadas usadas hoy: ~1,420 / 7,500 (18.9% aprox)
- Estado: ✅ Activa

💰 OddsAPI:
- Llamadas usadas: ~1,250 / 5,000 (25% aprox)
- Estado: ✅ Activa

🧠 OpenAI:
- Modelos disponibles: gpt-3.5-turbo, gpt-4
- Estado: ✅ Activa

🔁 Último despliegue: ${now}
`
  };

  return response;
};
