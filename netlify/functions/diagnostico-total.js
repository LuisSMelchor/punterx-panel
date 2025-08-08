// netlify/functions/diagnostico-total.cjs
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { OPENAI_API_KEY, API_FOOTBALL_KEY, ODDS_API_KEY, SUPABASE_URL, SUPABASE_KEY } = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async function () {
  const errores = [];

  // Verificar conexión Supabase
  let conexionSupabase = '🟢 OK';
  try {
    const { error } = await supabase.from('picks_historicos').select('*').limit(1);
    if (error) throw error;
  } catch (err) {
    conexionSupabase = '🔴 Error';
    errores.push(`Supabase: ${err.message}`);
  }

  // Verificar estado API-Football
  let estadoFootball = '🟢 OK';
  try {
    const res = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
    });
    const json = await res.json();
    if (!json || json.errors) throw new Error('No responde correctamente');
  } catch (err) {
    estadoFootball = '🔴 Error';
    errores.push(`API-Football: ${err.message}`);
  }

  // Verificar estado OddsAPI
  let estadoOdds = '🟢 OK';
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports`, {
      headers: { 'x-api-key': ODDS_API_KEY },
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('No responde correctamente');
  } catch (err) {
    estadoOdds = '🔴 Error';
    errores.push(`OddsAPI: ${err.message}`);
  }

  // Verificar estado OpenAI
  let estadoOpenAI = '🟢 OK';
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    const json = await res.json();
    if (!json || json.error) throw new Error('No responde correctamente');
  } catch (err) {
    estadoOpenAI = '🔴 Error';
    errores.push(`OpenAI: ${err.message}`);
  }

  // Consultar último pick
  let ultimoPick = 'No disponible';
  try {
    const { data } = await supabase
      .from('picks_historicos')
      .select('evento, timestamp, ev, nivel')
      .order('timestamp', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      const pick = data[0];
      const fecha = new Date(pick.timestamp).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
      });
      ultimoPick = `${pick.evento} | EV: ${pick.ev}% | ${pick.nivel} | ${fecha}`;
    }
  } catch (err) {
    errores.push(`Historial: ${err.message}`);
  }

  // Picks hoy
  let picksHoy = 0;
  try {
    const inicioDia = new Date();
    inicioDia.setUTCHours(0, 0, 0, 0);
    const finDia = new Date();
    finDia.setUTCHours(23, 59, 59, 999);
    const { data } = await supabase
      .from('picks_historicos')
      .select('id')
      .gte('timestamp', inicioDia.toISOString())
      .lte('timestamp', finDia.toISOString());
    picksHoy = data?.length || 0;
  } catch (err) {
    errores.push(`Picks hoy: ${err.message}`);
  }

  // Funciones activas (manual por ahora)
  const funcionesActivas = 1;

  // Estado general
  let estadoGeneral = errores.length > 0 ? '⚠️ Alerta' : '🟢 Estable';

  // HTML visual
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <title>Diagnóstico PunterX</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f9f9f9; color: #333; padding: 20px; }
        h1 { color: #111; }
        .status { margin: 10px 0; padding: 10px; background: #fff; border-radius: 8px; box-shadow: 0 0 6px rgba(0,0,0,0.1); }
        .ok { color: green; font-weight: bold; }
        .error { color: red; font-weight: bold; }
        .box { margin: 10px 0; padding: 15px; background: #fff; border-left: 5px solid #333; }
        .green { border-color: green; }
        .red { border-color: red; }
      </style>
    </head>
    <body>
      <h1>📊 Diagnóstico General - PunterX</h1>
      <div class="status">🧠 Estado general del sistema: <strong>${estadoGeneral}</strong></div>

      <div class="box ${conexionSupabase.includes('Error') ? 'red' : 'green'}">📦 Supabase: ${conexionSupabase}</div>
      <div class="box ${estadoFootball.includes('Error') ? 'red' : 'green'}">⚽ API-Football: ${estadoFootball}</div>
      <div class="box ${estadoOdds.includes('Error') ? 'red' : 'green'}">💰 OddsAPI: ${estadoOdds}</div>
      <div class="box ${estadoOpenAI.includes('Error') ? 'red' : 'green'}">🤖 OpenAI: ${estadoOpenAI}</div>

      <div class="status">📌 Último pick enviado: <strong>${ultimoPick}</strong></div>
      <div class="status">📈 Picks enviados hoy: <strong>${picksHoy}</strong></div>
      <div class="status">⚙️ Funciones activas: <strong>${funcionesActivas}</strong></div>

      ${
        errores.length > 0
          ? `<div class="box red">⚠️ Errores detectados:<br>${errores.map(e => `• ${e}`).join('<br>')}</div>`
          : `<div class="box green">✅ Sin errores reportados</div>`
      }
    </body>
    </html>
  `.trim();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};
