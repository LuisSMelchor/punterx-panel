const { createClient } = require('@supabase/supabase-js');

exports.handler = async function () {
  const supabaseUrl = process.env.supabaseUrl;
  const supabaseKey = process.env.supabaseKey;

  const openaiKey = process.env.OPENAI_API_KEY;
  const oddsKey = process.env.ODDS_API_KEY;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;

  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('picks_historicos')
    .select('*')
    .gte('timestamp', `${today}T00:00:00Z`)
    .order('timestamp', { ascending: false });

  let html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Diagnóstico PunterX</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 2rem; color: #222; }
      .card { background: white; border-radius: 12px; padding: 1.5rem 2rem; margin-bottom: 2rem; box-shadow: 0 0 12px rgba(0,0,0,0.1); }
      h2 { margin-top: 0; }
      .status-ok { color: green; font-weight: bold; }
      .status-error { color: red; font-weight: bold; }
      .metric { font-size: 1.5rem; margin: 0.5rem 0; }
      .section { margin-bottom: 1.5rem; }
    </style>
  </head>
  <body>
    <h1>📊 Diagnóstico del Sistema PunterX</h1>
  `;

  if (error) {
    html += `<div class="card"><p class="status-error">Error al consultar Supabase: ${error.message}</p></div>`;
  } else {
    const picksHoy = data || [];
    const evPromedio = picksHoy.length ? (picksHoy.reduce((sum, p) => sum + (p.ev || 0), 0) / picksHoy.length).toFixed(1) : 0;
    const niveles = {
      elite: picksHoy.filter(p => p.nivel === '🎯 Élite Mundial').length,
      informativo: picksHoy.filter(p => p.nivel === '📄 Informativo').length,
    };

    const ultimo = picksHoy[0];
    if (ultimo) {
      html += `
        <div class="card">
          <h2>🎯 Último Pick Generado</h2>
          <p><strong>Liga:</strong> ${ultimo.liga}</p>
          <p><strong>Partido:</strong> ${ultimo.equipos}</p>
          <p><strong>Hora:</strong> ${ultimo.hora || 'No disponible'}</p>
          <p><strong>Apuesta sugerida:</strong> ${ultimo.apuesta}</p>
          <p><strong>EV:</strong> +${ultimo.ev}% (valor detectado por IA)</p>
          <p><strong>Nivel:</strong> ${ultimo.nivel}</p>
        </div>
      `;
    }

    html += `
      <div class="card">
        <h2>📈 Métricas rápidas</h2>
        <p class="metric">📦 ${picksHoy.length} Picks enviados hoy</p>
        <p class="metric">📊 EV promedio del día: ${evPromedio}%</p>
        <p class="metric">🎯 Picks nivel Élite Mundial: ${niveles.elite}</p>
        <p class="metric">📄 Picks canal gratuito: ${niveles.informativo}</p>
      </div>
    `;
  }

  // Estado del sistema
  html += `
    <div class="card">
      <h2>🛠️ Estado del Sistema</h2>
      <p>🧠 Supabase: <span class="${supabaseUrl && supabaseKey ? 'status-ok' : 'status-error'}">${supabaseUrl && supabaseKey ? '✅ OK' : '❌ Error'}</span></p>
      <p>🤖 OpenAI: <span class="${openaiKey ? 'status-ok' : 'status-error'}">${openaiKey ? '✅ OK' : '❌ Error'}</span></p>
      <p>⚽ API-Football: <span class="${apiFootballKey ? 'status-ok' : 'status-error'}">${apiFootballKey ? '✅ OK' : '❌ Error'}</span></p>
      <p>📉 OddsAPI: <span class="${oddsKey ? 'status-ok' : 'status-error'}">${oddsKey ? '✅ OK' : '❌ Error'}</span></p>
    </div>
  `;

  // Frase final de branding
  html += `
    <div class="card">
      <h2>🤖 Diagnóstico de IA</h2>
      <p>🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.</p>
      <p>📣 Este sistema está en constante aprendizaje para detectar patrones, errores y picks de oro.</p>
    </div>
  `;

  html += `</body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};
