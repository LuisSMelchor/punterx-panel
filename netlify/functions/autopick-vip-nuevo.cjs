// autopick-vip-nuevo.cjs COMPLETO CON TODO INTEGRADO
import fetch from 'node-fetch';
import { Configuration, OpenAIApi } from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;

const getTodayDate = () => new Date().toISOString().split('T')[0];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const obtenerPartidosOddsAPI = async () => {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?regions=eu&oddsFormat=decimal&dateFormat=iso&apiKey=${process.env.ODDS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`❌ Error al obtener partidos: ${res.statusText}`);
  return await res.json();
};

const obtenerDetallesApiFootball = async (fixtureId) => {
  const headers = { 'x-apisports-key': process.env.API_FOOTBALL_KEY };

  const endpoints = {
    alineaciones: `https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`,
    arbitro: `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
    historial: `https://v3.football.api-sports.io/fixtures/headtohead?h2h=${fixtureId}`,
    estadisticasLocales: `https://v3.football.api-sports.io/teams/statistics?team=HOME_TEAM_ID&season=2024&league=LEAGUE_ID`,
    estadisticasVisitantes: `https://v3.football.api-sports.io/teams/statistics?team=AWAY_TEAM_ID&season=2024&league=LEAGUE_ID`,
  };

  const results = {};
  for (const [key, url] of Object.entries(endpoints)) {
    const res = await fetch(url, { headers });
    const data = await res.json();
    results[key] = data.response;
    await delay(100); // delay para evitar rate limit
  }
  return results;
};

const calcularEV = (probabilidad, cuota) => {
  const ev = (probabilidad / 100) * cuota - 1;
  return Math.round(ev * 100);
};

const generarMensajeIA = async (datos) => {
  const prompt = `Eres un analista deportivo experto. Analiza este partido:

Datos:
${JSON.stringify(datos, null, 2)}

Devuélveme un JSON con los siguientes campos:
- analisis_gratuito
- analisis_vip
- apuesta
- apuestas_extra
- frase_motivacional`;

  const completion = await openai.createChatCompletion({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
  });

  const respuesta = completion.data.choices[0].message.content;
  return JSON.parse(respuesta);
};

const enviarTelegram = async (chatId, text) => {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  return await res.json();
};

export async function handler() {
  const partidos = await obtenerPartidosOddsAPI();
  console.log(`📅 ${partidos.length} partidos encontrados para hoy ${getTodayDate()}.`);

  for (const partido of partidos) {
    const horaPartido = new Date(partido.commence_time).getTime();
    const ahora = new Date().getTime();
    const minutos = (horaPartido - ahora) / (1000 * 60);

    if (minutos < 45 || minutos > 55) continue;

    const equipos = `${partido.home_team} vs ${partido.away_team}`;
    console.log(`🔍 Analizando: ${equipos}`);

    const fixtureId = 'USAR_ID_REAL'; // deberás mapear partido de OddsAPI a fixtureId de API-FOOTBALL
    const detalles = await obtenerDetallesApiFootball(fixtureId);

    const datosIA = {
      equipos,
      liga: partido.sport_key,
      horario_aproximado: `Comienza en ${Math.round(minutos)} minutos`,
      alineaciones: detalles.alineaciones,
      arbitro: detalles.arbitro,
      historial: detalles.historial,
      estadisticas_locales: detalles.estadisticasLocales,
      estadisticas_visitantes: detalles.estadisticasVisitantes,
    };

    const analisis = await generarMensajeIA(datosIA);

    const cuota = parseFloat(partido.bookmakers[0]?.markets[0]?.outcomes[0]?.price || 1.5);
    const probabilidad = 60; // estimación inicial, puede venir de IA
    const ev = calcularEV(probabilidad, cuota);

    const mensajeVIP = `🎯 PICK NIVEL: Hallazgo VIP
${equipos} (${partido.sport_title})
Hora: ${datosIA.horario_aproximado}
Probabilidad estimada: ${probabilidad}%
EV: ${ev}%
Apuesta sugerida: ${analisis.apuesta}
Apuestas extra: ${analisis.apuestas_extra}

${analisis.analisis_vip}

⚠️ Este contenido es informativo. Apostar conlleva riesgo.`;

    const mensajeGratis = `📡 RADAR DE VALOR
${equipos} (${partido.sport_title})
Hora: ${datosIA.horario_aproximado}

${analisis.analisis_gratuito}

${analisis.frase_motivacional}
Únete al grupo VIP gratis 15 días: @punterxpicks`;

    if (ev >= 15) await enviarTelegram(TELEGRAM_GROUP_ID, mensajeVIP);
    else if (ev >= 10) await enviarTelegram(TELEGRAM_CHANNEL_ID, mensajeGratis);

    await supabase.from('picks_historicos').insert({
      evento: equipos,
      analisis: analisis.analisis_vip,
      apuesta: analisis.apuesta,
      tipo_pick: 'VIP',
      liga: partido.sport_title,
      equipos,
      ev,
      probabilidad,
      nivel: 'Hallazgo VIP',
      timestamp: new Date().toISOString(),
    });

    await delay(1000);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
}
