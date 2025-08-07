const fetch = require('node-fetch');

exports.handler = async function (event, context) {
  const startTime = Date.now();

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ status: '❌ ERROR', message: 'Faltan variables de entorno necesarias.' })
      };
    }

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos?select=*`, { headers });
    const data = await response.json();

    const total = data.length || 0;
    const ultPick = data[total - 1]?.timestamp || "No disponible";

    const mem = process.memoryUsage();

    const duracion = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "✅ Diagnóstico OK",
        timestamp: "2025-08-07T02:31:52.802648",
        total_picks: total,
        ultimo_pick: ultPick,
        entorno: process.env.NODE_ENV || "No definido",
        uso_memoria: {
          rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`
        },
        duracion_ejecucion: `${duracion} segundos`,
        mensaje: "📊 Sistema monitoreado exitosamente. Todo está en orden.",
        version: "v2 Diagnóstico Pro"
      }, null, 2)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        status: "❌ ERROR",
        error: error.message,
        mensaje: "Ocurrió un problema al generar el diagnóstico."
      })
    };
  }
};
