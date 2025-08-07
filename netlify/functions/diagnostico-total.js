const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

exports.handler = async () => {
  try {
    // Configuración
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verificar conexión a Supabase
    const { data: picks, error: errorPicks } = await supabase
      .from('picks_historicos')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1);

    const { data: picksHoy, error: errorHoy } = await supabase
      .from('picks_historicos')
      .select('id', { count: 'exact', head: true })
      .gte('timestamp', new Date().toISOString().split('T')[0]);

    const ultimoPick = picks?.[0]?.evento || 'No disponible';
    const cantidadHoy = picksHoy?.length || 0;
    const estadoSupabase = errorPicks || errorHoy ? '❌ Error' : '✅ OK';

    // Verificar API-Football
    const resFootball = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
    });
    const estadoFootball = resFootball.ok ? '✅ OK' : '❌ Error';

    // Verificar OddsAPI
    const resOdds = await fetch(`https://api.the-odds-api.com/v4/sports`, {
      headers: { 'x-api-key': process.env.ODDS_API_KEY }
    });
    const estadoOdds = resOdds.ok ? '✅ OK' : '❌ Error';

    // Verificar OpenAI
    const resOpenAI = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    const estadoOpenAI = resOpenAI.ok ? '✅ OK' : '❌ Error';

    // Evaluar estado general
    const todoOK = [estadoSupabase, estadoFootball, estadoOdds, estadoOpenAI].every((e) => e === '✅ OK');
    const estadoGeneral = todoOK ? '🟢 Estable' : '🔴 Inestable';

    // HTML de respuesta
    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <title>Diagnóstico PunterX</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; color: #333; }
          h1 { color: #222; }
          .ok { color: green; }
          .error { color: red; }
          .panel { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 0 10px #ccc; }
          .status { font-size: 18px; margin-bottom: 10px; }
        </style>
      </head>
      <body>
        <div class="panel">
          <h1>📊 Diagnóstico del sistema PunterX</h1>
          <div class="status"><strong>🧠 Supabase:</strong> <span class="${estadoSupabase.includes('✅') ? 'ok' : 'error'}">${estadoSupabase}</span></div>
          <div class="status"><strong>⚽ API-Football:</strong> <span class="${estadoFootball.includes('✅') ? 'ok' : 'error'}">${estadoFootball}</span></div>
          <div class="status"><strong>📈 OddsAPI:</strong> <span class="${estadoOdds.includes('✅') ? 'ok' : 'error'}">${estadoOdds}</span></div>
          <div class="status"><strong>🤖 OpenAI:</strong> <span class="${estadoOpenAI.includes('✅') ? 'ok' : 'error'}">${estadoOpenAI}</span></div>
          <hr />
          <div class="status"><strong>📌 Último pick enviado:</strong> ${ultimoPick}</div>
          <div class="status"><strong>📅 Picks enviados hoy:</strong> ${cantidadHoy}</div>
          <hr />
          <div class="status"><strong>🔍 Estado general:</strong> <span class="${todoOK ? 'ok' : 'error'}">${estadoGeneral}</span></div>
        </div>
      </body>
      </html>
    `;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: html
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: `<h1>Error al generar diagnóstico</h1><pre>${error.message}</pre>`
    };
  }
};
