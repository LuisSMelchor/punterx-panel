const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { Configuration, OpenAIApi } = require('openai');

// Optional: load environment variables locally. In Netlify, they are provided automatically.
require('dotenv').config();

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
the SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

// Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async () => {
  let errores = [];
  let estadoGeneral = 'Estable 🟢';

  // Último pick
  let ultimoPick = 'No disponible';
  try {
    const { data: dataUltimo, error } = await supabase
      .from('picks_historicos')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (dataUltimo && dataUltimo.length > 0) {
      const fecha = new Date(dataUltimo[0].timestamp);
      ultimoPick = fecha.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City'
      });
    }
  } catch (err) {
    errores.push('Supabase: error al obtener último pick');
  }

  // Picks registrados hoy
  let picksHoy = 0;
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('id')
      .gte('timestamp', hoy.toISOString());
    if (error) throw error;
    picksHoy = data.length;
  } catch (err) {
    errores.push('Supabase: error al contar picks de hoy');
  }

  // Funciones Netlify
  let funcionesActivas = 0;
  try {
    const files = fs.readdirSync(__dirname);
    funcionesActivas = files.filter((f) => /\.(js|cjs|ts)$/i.test(f)).length;
  } catch (err) {
    errores.push('Netlify: error al contar funciones');
  }

  // API-Football
  let estadoFootball = 'OK';
  try {
    const res = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    });
    if (!res.ok) throw new Error();
    const json = await res.json();
    if (!json.response || !json.response.account) throw new Error();
  } catch (err) {
    estadoFootball = 'Error ❌';
    errores.push('API-Football: error de conexión');
  }

  // OddsAPI
  let estadoOdds = 'OK';
  try {
    const res = await fetch(
      `https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}`
    );
    if (!res.ok) throw new Error();
    await res.json();
  } catch (err) {
    estadoOdds = 'Error ❌';
    errores.push('OddsAPI: error de conexión');
  }

  // OpenAI
  let estadoOpenAI = 'OK';
  try {
    const config = new Configuration({ apiKey: OPENAI_API_KEY });
    const openai = new OpenAIApi(config);
    await openai.listModels();
  } catch (err) {
    estadoOpenAI = 'Error ❌';
    errores.push('OpenAI: error de conexión');
  }

  if (errores.length > 0) estadoGeneral = 'Inestable 🔴';

  const resultado = {
    ultimoPick,
    conexionSupabase: errores.some((e) => e.includes('Supabase'))
      ? 'Error ❌'
      : 'OK',
    funcionesActivas,
    picksHoy,
    estadoFootball,
    estadoOdds,
    estadoOpenAI,
    estadoGeneral,
    errores
  };

  // Logging for debugging
  console.log(JSON.stringify(resultado, null, 2));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resultado)
  };
};

// Instruct Netlify bundler to treat certain modules as external
exports.config = {
  external_node_modules: ['openai', 'node-fetch']
};
