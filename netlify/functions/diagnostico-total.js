const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

exports.handler = async () => {
  const errores = [];
  let conexionSupabase = "❌ ERROR";
  let funcionesActivas = 0;
  let picksHoy = 0;
  let ultimoPick = "No disponible";
  let estadoFootball = "❌";
  let estadoOdds = "❌";
  let estadoOpenAI = "❌";

  // Verifica Supabase
  try {
    const { data, error } = await supabase
      .from("picks_historicos")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(1);

    if (error) throw error;
    conexionSupabase = "✅ OK";

    if (data.length > 0) {
      const pick = data[0];
      ultimoPick = `${pick.equipos} (${pick.ev}% EV)`;
    }
  } catch (err) {
    errores.push("Supabase: " + err.message);
  }

  // Verifica cuántos picks hoy
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const { count, error } = await supabase
      .from("picks_historicos")
      .select("*", { count: "exact", head: true })
      .gte("timestamp", `${hoy}T00:00:00.000Z`);

    if (error) throw error;
    picksHoy = count || 0;
  } catch (err) {
    errores.push("Conteo de picks hoy: " + err.message);
  }

  // Verifica API-Football
  try {
    const res = await fetch(
      "https://v3.football.api-sports.io/status",
      { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
    );
    if (res.ok) estadoFootball = "✅ OK";
    else errores.push("API-Football: Status " + res.status);
  } catch (err) {
    errores.push("API-Football: " + err.message);
  }

  // Verifica OddsAPI
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${process.env.ODDS_API_KEY}`
    );
    if (res.ok) estadoOdds = "✅ OK";
    else errores.push("OddsAPI: Status " + res.status);
  } catch (err) {
    errores.push("OddsAPI: " + err.message);
  }

  // Verifica OpenAI
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    if (res.ok) estadoOpenAI = "✅ OK";
    else errores.push("OpenAI: Status " + res.status);
  } catch (err) {
    errores.push("OpenAI: " + err.message);
  }

  // Verifica funciones activas (dummy logic si no tienes tracking real)
  funcionesActivas = 1; // Puedes automatizar si quieres más adelante

  const estadoGeneral = errores.length === 0 ? "🟢 Estable" : "🟠 Con advertencias";

  const html = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>🧠 Diagnóstico PunterX</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 30px; color: #333; }
      .card { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
      h1 { font-size: 24px; color: #333; }
      h2 { font-size: 20px; color: #444; }
      .estado { font-size: 18px; margin: 5px 0; }
      .ok { color: green; }
      .error { color: red; }
      .advertencia { color: orange; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .footer { font-size: 14px; margin-top: 40px; color: #777; }
    </style>
  </head>
  <body>
    <h1>📊 Diagnóstico General del Sistema <span style="float:right;">${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</span></h1>

    <div class="card">
      <h2>🧠 Estado del sistema: ${estadoGeneral}</h2>
      <div class="grid">
        <div class="estado">📤 Último pick: <strong>${ultimoPick}</strong></div>
        <div class="estado">📅 Picks hoy: <strong>${picksHoy}</strong></div>
        <div class="estado">⚙️ Funciones activas: <strong>${funcionesActivas}</strong></div>
        <div class="estado">🔗 Supabase: <strong class="${conexionSupabase.includes('OK') ? 'ok' : 'error'}">${conexionSupabase}</strong></div>
        <div class="estado">⚽ API-Football: <strong class="${estadoFootball.includes('OK') ? 'ok' : 'error'}">${estadoFootball}</strong></div>
        <div class="estado">📊 OddsAPI: <strong class="${estadoOdds.includes('OK') ? 'ok' : 'error'}">${estadoOdds}</strong></div>
        <div class="estado">🧠 OpenAI: <strong class="${estadoOpenAI.includes('OK') ? 'ok' : 'error'}">${estadoOpenAI}</strong></div>
      </div>
    </div>

    ${errores.length > 0 ? `
      <div class="card">
        <h2>⚠️ Errores detectados</h2>
        <ul>${errores.map(err => `<li class="advertencia">${err}</li>`).join('')}</ul>
      </div>
    ` : `
      <div class="card">
        <h2>✅ Sin errores actuales</h2>
      </div>
    `}

    <div class="footer">
      Sistema automatizado PunterX · Diagnóstico generado automáticamente<br/>
      Zona horaria: <strong>CDMX</strong> · Versión: Diagnóstico HTML v1.0
    </div>
  </body>
  </html>
  `;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: html,
  };
};
