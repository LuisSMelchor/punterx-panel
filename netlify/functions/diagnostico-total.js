// netlify/functions/diagnostico-total.js
const fetch = require('node-fetch');

exports.handler = async function () {
  try {
    const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });

    const respuestas = [];

    // 1. Verificar variables de entorno requeridas
    const variables = [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_CHANNEL_ID',
      'TELEGRAM_GROUP_ID',
      'OPENAI_API_KEY',
      'API_FOOTBALL_KEY',
      'ODDS_API_KEY',
      'SUPABASE_URL',
      'SUPABASE_KEY',
      'PUNTERX_SECRET'
    ];

    const faltantes = variables.filter(v => !process.env[v]);
    if (faltantes.length > 0) {
      respuestas.push(`❌ Variables de entorno faltantes: ${faltantes.join(', ')}`);
    } else {
      respuestas.push('✅ Todas las variables de entorno necesarias están presentes.');
    }

    // 2. Checar conexión a Supabase
    try {
      const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/picks_historicos?select=evento&limit=1`, {
        headers: {
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        },
      });
      if (res.ok) {
        respuestas.push('✅ Conexión exitosa a Supabase.');
      } else {
        respuestas.push('❌ Error al conectar con Supabase.');
      }
    } catch (e) {
      respuestas.push('❌ Error de red al conectar con Supabase.');
    }

    // 3. Verificar consumo de API-Football (plan diario)
    try {
      const res = await fetch('https://v3.football.api-sports.io/status', {
        headers: {
          'x-apisports-key': process.env.API_FOOTBALL_KEY,
        },
      });
      const data = await res.json();
      const requests = data.response.requests;
      respuestas.push(`📊 API-Football hoy: ${requests.current} / ${requests.limit} peticiones.`);
    } catch (e) {
      respuestas.push('❌ No se pudo obtener el estado de API-Football.');
    }

    // 4. Verificar consumo de OddsAPI (plan mensual)
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${process.env.ODDS_API_KEY}`);
      const remaining = res.headers.get("x-requests-remaining");
      const used = res.headers.get("x-requests-used");

      if (remaining && used) {
        respuestas.push(`📊 OddsAPI este mes: ${used} usadas / ${parseInt(used) + parseInt(remaining)} disponibles.`);
      } else {
        respuestas.push('❌ No se pudo obtener el estado mensual de OddsAPI.');
      }
    } catch (e) {
      respuestas.push('❌ No se pudo conectar con OddsAPI.');
    }

    // 5. Formato visual bonito
    const diagnostico = [
      '🧪 DIAGNÓSTICO GENERAL - SISTEMA PUNTERX 🧠',
      `📅 Fecha y hora CDMX: ${ahora}`,
      '',
      ...respuestas,
      '',
      '📌 Revisa este diagnóstico periódicamente para detectar errores u omisiones.',
    ].join('\n');

    return {
      statusCode: 200,
      body: diagnostico,
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: '❌ Error crítico en el diagnóstico del sistema. ' + error.message,
    };
  }
};
