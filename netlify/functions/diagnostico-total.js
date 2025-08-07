// netlify/functions/diagnostico-total.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ESTADO_OK = '<span style="color:green;font-weight:bold">OK</span>';
const ESTADO_ERROR = '<span style="color:red;font-weight:bold">ERROR</span>';
const estadoColor = (estado) => estado === 'OK' ? '🟢 Estable' : '🔴 Inestable';

export default async function handler(req, res) {
  const now = new Date();
  const fechaActual = now.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  let estadoSupabase = 'OK';
  let estadoFootball = 'OK';
  let estadoOdds = 'OK';
  let estadoOpenAI = 'OK';
  let picksHoy = 0;
  let ultimoPick = 'No disponible';
  let funcionesActivas = 0;
  let errores = [];
  let estadoGeneral = 'Estable 🟢';

  try {
    // Verificar Supabase y obtener picks recientes
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(5);

    if (error) throw error;

    const hoy = new Date().toISOString().split('T')[0];
    picksHoy = data.filter(p => p.timestamp.startsWith(hoy)).length;
    ultimoPick = data[0]?.evento || 'No disponible';
  } catch (e) {
    estadoSupabase = 'ERROR';
    errores.push('❌ Supabase: ' + e.message);
  }

  // Verificar APIs externas
  try {
    const res1 = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
    });
    if (!res1.ok) throw new Error('API-FOOTBALL no responde');
  } catch (e) {
    estadoFootball = 'ERROR';
    errores.push('⚠️ API-Football: ' + e.message);
  }

  try {
    const res2 = await fetch(`https://api.the-odds-api.com/v4/sports`, {
      headers: { 'x-api-key': process.env.ODDS_API_KEY }
    });
    if (!res2.ok) throw new Error('OddsAPI no responde');
  } catch (e) {
    estadoOdds = 'ERROR';
    errores.push('⚠️ OddsAPI: ' + e.message);
  }

  try {
    const res3 = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    });
    if (!res3.ok) throw new Error('OpenAI no responde');
  } catch (e) {
    estadoOpenAI = 'ERROR';
    errores.push('⚠️ OpenAI: ' + e.message);
  }

  // Verificar funciones activas desde Netlify env
  try {
    funcionesActivas = 1; // Aquí puedes integrar con un contador real si lo deseas
  } catch (e) {
    errores.push('⚠️ No se pudo contar funciones activas');
  }

  if ([estadoSupabase, estadoFootball, estadoOdds, estadoOpenAI].includes('ERROR')) {
    estadoGeneral = '⚠️ Inestable 🔴';
  }

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Diagnóstico PunterX</title>
        <style>
          body { font-family: Arial, sans-serif; background:#f8f8f8; color:#333; padding:30px; }
          h1 { color:#2c3e50; }
          .ok { color: green; font-weight: bold; }
          .error { color: red; font-weight: bold; }
          .box { background:#fff; padding:20px; border-radius:8px; box-shadow:0 0 5px rgba(0,0,0,0.1); max-width:700px; margin:auto; }
          .status { margin-bottom:10px; }
          .errores { margin-top:20px; color:#e74c3c; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>📊 Diagnóstico General de PunterX</h1>
          <p><strong>Fecha y hora:</strong> ${fechaActual}</p>
          <p class="status"><strong>Estado general:</strong> ${estadoGeneral}</p>
          <p><strong>Último pick enviado:</strong> ${ultimoPick}</p>
          <p><strong>Número de picks hoy:</strong> ${picksHoy}</p>
          <p><strong>Funciones activas:</strong> ${funcionesActivas}</p>
          <hr />
          <p><strong>🧠 Supabase:</strong> ${estadoSupabase === 'OK' ? ESTADO_OK : ESTADO_ERROR}</p>
          <p><strong>⚽ API-Football:</strong> ${estadoFootball === 'OK' ? ESTADO_OK : ESTADO_ERROR}</p>
          <p><strong>📈 OddsAPI:</strong> ${estadoOdds === 'OK' ? ESTADO_OK : ESTADO_ERROR}</p>
          <p><strong>🤖 OpenAI:</strong> ${estadoOpenAI === 'OK' ? ESTADO_OK : ESTADO_ERROR}</p>

          ${errores.length > 0 ? `
            <div class="errores">
              <h3>Errores recientes:</h3>
              <ul>
                ${errores.map(e => `<li>${e}</li>`).join('')}
              </ul>
            </div>` : ''}
        </div>
      </body>
    </html>
  `;

  res.status(200).setHeader('Content-Type', 'text/html').end(html);
}
