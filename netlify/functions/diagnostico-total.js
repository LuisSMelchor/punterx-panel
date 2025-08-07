const fetch = globalThis.fetch;
const { createClient } = require('@supabase/supabase-js');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
require('dayjs/locale/es');
require('dotenv').config();
const fs = require('fs');

// Configuración de dayjs
dayjs.extend(relativeTime);
dayjs.locale('es');

// Esqueleto futuro para diagnóstico nivel 2
async function diagnosticoNivel2() {
  // Se implementará en el futuro
}

exports.handler = async () => {
  console.log('Iniciando diagnóstico total nivel 1');

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // Último pick
    const { data: ultimoPickData, error: errorUltimo } = await supabase
      .from('picks_historicos')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1);
    if (errorUltimo) throw errorUltimo;

    const ultimoTimestamp = ultimoPickData?.[0]?.timestamp;
    const ultimoPick = ultimoTimestamp ? dayjs().to(dayjs(ultimoTimestamp)) : 'No disponible';
    console.log('Último pick timestamp:', ultimoTimestamp);

    // Picks hoy
    const inicioHoy = dayjs().startOf('day').toISOString();
    const { count: picksHoy, error: errorHoy } = await supabase
      .from('picks_historicos')
      .select('*', { count: 'exact', head: true })
      .gte('timestamp', inicioHoy);
    if (errorHoy) throw errorHoy;
    console.log('Picks registrados hoy:', picksHoy);

    // Contar funciones de Netlify
    const functionsDir = __dirname;
    const funcionesActivas = fs
      .readdirSync(functionsDir)
      .filter((f) =>
        /\.(js|cjs|ts)$/i.test(f) &&
        !f.includes('diagnostico-total')
      ).length;
    console.log('Funciones activas detectadas:', funcionesActivas);

    let estadoGeneral = 'Estable 🟢';
    const resultadosApis = [];

    // API-FOOTBALL
    try {
      const r = await fetch('https://v3.football.api-sports.io/status', {
        headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
      });
      resultadosApis.push(`🌐 API-FOOTBALL: ${r.ok ? 'OK' : 'Error ' + r.status}`);
      if (!r.ok) estadoGeneral = 'Inestable 🔴';
      console.log('API-FOOTBALL status:', r.status);
    } catch (e) {
      resultadosApis.push('🌐 API-FOOTBALL: Error');
      estadoGeneral = 'Inestable 🔴';
      console.log('API-FOOTBALL error:', e);
    }

    // OddsAPI
    try {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${process.env.ODDS_API_KEY}`);
      resultadosApis.push(`📊 OddsAPI: ${r.ok ? 'OK' : 'Error ' + r.status}`);
      if (!r.ok) estadoGeneral = 'Inestable 🔴';
      console.log('OddsAPI status:', r.status);
    } catch (e) {
      resultadosApis.push('📊 OddsAPI: Error');
      estadoGeneral = 'Inestable 🔴';
      console.log('OddsAPI error:', e);
    }

    // OpenAI
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
      });
      resultadosApis.push(`🤖 OpenAI: ${r.ok ? 'OK' : 'Error ' + r.status}`);
      if (!r.ok) estadoGeneral = 'Inestable 🔴';
      console.log('OpenAI status:', r.status);
    } catch (e) {
      resultadosApis.push('🤖 OpenAI: Error');
      estadoGeneral = 'Inestable 🔴';
      console.log('OpenAI error:', e);
    }

    const resultado = [
      `🔄 Último pick enviado: ${ultimoPick}`,
      `✅ Conexión a Supabase: OK`,
      `⚙️ Funciones activas en Netlify: ${funcionesActivas}`,
      `📅 Picks registrados hoy: ${picksHoy ?? 0}`,
      ...resultadosApis,
      `🚀 Estado general: ${estadoGeneral}`
    ].join('\n');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: resultado
    };

  } catch (error) {
    console.error('Error al generar el diagnóstico:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: `❌ Error al generar el diagnóstico: ${error.message || JSON.stringify(error)}`
    };
  }
};
