// netlify/functions/diagnostico-total.cjs
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { OPENAI_API_KEY, API_FOOTBALL_KEY, ODDS_API_KEY, SUPABASE_URL, SUPABASE_KEY } = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async function () {
  const errores = [];

  // Verificar conexión Supabase
  let conexionSupabase = 'OK';
  try {
    const { error } = await supabase.from('picks_historicos').select('*').limit(1);
    if (error) throw error;
  } catch (err) {
    conexionSupabase = 'Error';
    errores.push(`Supabase: ${err.message}`);
  }

  // Verificar estado API-Football
  let estadoFootball = 'OK';
  try {
    const res = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
    });
    const json = await res.json();
    if (!json || json.errors) throw new Error('No responde correctamente');
  } catch (err) {
    estadoFootball = 'Error';
    errores.push(`API-Football: ${err.message}`);
  }

  // Verificar estado OddsAPI
  let estadoOdds = 'OK';
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports`, {
      headers: { 'x-api-key': ODDS_API_KEY },
    });
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('No responde correctamente');
  } catch (err) {
    estadoOdds = 'Error';
    errores.push(`OddsAPI: ${err.message}`);
  }

  // Verificar estado OpenAI
  let estadoOpenAI = 'OK';
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    const json = await res.json();
    if (!json || json.error) throw new Error('No responde correctamente');
  } catch (err) {
    estadoOpenAI = 'Error';
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
      .select('id', { count: 'exact' })
      .gte('timestamp', inicioDia.toISOString())
      .lte('timestamp', finDia.toISOString());
    picksHoy = data?.length || 0;
  } catch (err) {
    errores.push(`Picks hoy: ${err.message}`);
  }

  // Simulación funciones activas
  const funcionesActivas = 1; // Manual por ahora

  // Diagnóstico general
  let estadoGeneral = 'Estable 🟢';
  if (errores.length > 0) estadoGeneral = 'Alerta ⚠️';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      estadoGeneral,
      conexionSupabase,
      estadoFootball,
      estadoOdds,
      estadoOpenAI,
      funcionesActivas,
      picksHoy,
      ultimoPick,
      errores,
    }),
  };
};
