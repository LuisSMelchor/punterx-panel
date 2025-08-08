const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { Configuration, OpenAIApi } = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_GROUP = process.env.TELEGRAM_GROUP_ID;

exports.handler = async function () {
  try {
    const partidos = await obtenerPartidosDesdeOddsAPI();
    for (const partido of partidos) {
      const yaExiste = await verificarSiYaFueEnviado(partido.id);
      if (yaExiste) continue;

      const enriquecido = await enriquecerPartidoConAPIFootball(partido);
      if (!enriquecido || Object.keys(enriquecido).length === 0) continue;

      const memoria = await obtenerMemoriaSimilar(partido);
      const prompt = construirPrompt(partido, enriquecido, memoria);

      let pick;
      try {
        const completion = await openai.createChatCompletion({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
        });

        const respuesta = completion.data.choices[0]?.message?.content;
        pick = JSON.parse(respuesta);

        if (!pick || !pick.analisis_vip || !pick.apuesta || !pick.analisis_gratuito) continue;
      } catch (error) {
        console.error('Error al generar o parsear respuesta de GPT:', error);
        continue;
      }

      const probabilidad = estimarProbabilidad(pick, partido);
      const ev = calcularEV(probabilidad, partido.mejorCuota.valor);

      if (ev < 10) continue;

      const nivel = clasificarPickPorEV(ev);
      const tipo_pick = ev >= 15 ? 'vip' : 'gratuito';

      const mensaje = tipo_pick === 'vip'
        ? construirMensajeVIP(partido, pick, probabilidad, ev, nivel)
        : construirMensajeFree(partido, pick);

      await enviarMensajeTelegram(mensaje, tipo_pick);
      await guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidad, ev);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ mensaje: 'Picks procesados correctamente' }),
    };
  } catch (error) {
    console.error('Error general en autopick-vip-nuevo:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};

// --------------------- HELPERS ----------------------------

async function obtenerPartidosDesdeOddsAPI() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${process.env.ODDS_API_KEY}&regions=eu,us,uk&markets=h2h,totals&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Error al obtener datos de OddsAPI');
    return [];
  }
  const data = await res.json();

  const ahora = Date.now();
  return data.filter(evento => {
    const inicio = new Date(evento.commence_time).getTime();
    const minutosFaltantes = (inicio - ahora) / 60000;
    return minutosFaltantes >= 45 && minutosFaltantes <= 55;
  }).map(evento => {
    const mercados = evento.bookmakers?.flatMap(b => b.markets || []) || [];
    const mejorCuota = mercados.flatMap(m => m.outcomes || [])
      .reduce((max, o) => o.price > (max?.price || 0) ? o : max, null);

    return {
      id: evento.id,
      equipos: `${evento.home_team} vs ${evento.away_team}`,
      timestamp: new Date(evento.commence_time).getTime(),
      mejorCuota: {
        valor: mejorCuota?.price || 1.5,
        casa: mejorCuota?.name || 'Desconocida'
      }
    };
  });
}

async function enriquecerPartidoConAPIFootball(partido) {
  const url = `https://v3.football.api-sports.io/fixtures?team=${partido.id}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }
  });

  if (!res.ok) {
    console.error(`Error al consultar API-FOOTBALL para partido ${partido.id}`);
    return null;
  }

  const data = await res.json();
  return data.response?.[0] || null;
}

async function verificarSiYaFueEnviado(idEvento) {
  const { data } = await supabase
    .from('picks_historicos')
    .select('evento')
    .eq('evento', idEvento);
  return data && data.length > 0;
}

function construirPrompt(partido, info, memoria) {
  return `
Analiza el siguiente partido y genera un análisis avanzado para apostadores.

Equipos: ${partido.equipos}
Hora: Comienza en menos de 1 hora
Cuota máxima: ${partido.mejorCuota.valor} (${partido.mejorCuota.casa})
Memoria de apuestas similares: ${JSON.stringify(memoria || [])}
Datos adicionales: ${JSON.stringify(info)}

Devuelve solo JSON con las siguientes claves:
- analisis_gratuito
- analisis_vip
- apuesta
- apuestas_extra
- frase_motivacional
`.trim();
}

function estimarProbabilidad(pick, partido) {
  // Estimación simple por ahora
  return 100 / partido.mejorCuota.valor;
}

function calcularEV(probabilidad, cuota) {
  return Math.round((probabilidad * (cuota - 1) - (100 - probabilidad)) * 100) / 100;
}

function clasificarPickPorEV(ev) {
  if (ev >= 40) return 'Ultra Elite';
  if (ev >= 30) return 'Élite Mundial';
  if (ev >= 20) return 'Avanzado';
  if (ev >= 15) return 'Competitivo';
  return 'Informativo';
}

function construirMensajeVIP(partido, pick, probabilidad, ev, nivel) {
  return `
🎯 PICK NIVEL: ${nivel}
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.equipos}
🕒 Comienza en menos de 1 hora

📊 Cuota: ${partido.mejorCuota.valor} (${partido.mejorCuota.casa})
📈 Probabilidad estimada: ${Math.round(probabilidad)}%
💰 Valor esperado: ${ev}%

💡 Apuesta sugerida: ${pick.apuesta}
🎯 Apuestas extra: ${pick.apuestas_extra || 'N/A'}

📌 Datos avanzados:
${pick.analisis_vip}

⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.
`.trim();
}

function construirMensajeFree(partido, pick) {
  return `
📡 RADAR DE VALOR
🏆 Liga: ${partido.liga || 'No especificada'}
📅 ${partido.equipos}
🕒 Comienza en menos de 1 hora

📌 Análisis de los expertos:
${pick.analisis_gratuito}

💬 ${pick.frase_motivacional}

🎁 ¡Únete 15 días gratis al grupo VIP!
@punterxpicks

⚠️ Este contenido es informativo. Apuesta bajo tu propio criterio y riesgo.
`.trim();
}

async function enviarMensajeTelegram(texto, tipo) {
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP : TELEGRAM_CHANNEL;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto })
  });
}

async function guardarEnSupabase(partido, pick, tipo_pick, nivel, probabilidad, ev) {
  await supabase.from('picks_historicos').insert([{
    evento: partido.id,
    analisis: pick.analisis_vip,
    apuesta: pick.apuesta,
    tipo_pick,
    liga: partido.liga || 'No especificada',
    equipos: partido.equipos,
    ev,
    probabilidad,
    nivel,
    timestamp: new Date().toISOString()
  }]);
}

async function obtenerMemoriaSimilar(partido) {
  const { data } = await supabase
    .from('picks_historicos')
    .select('evento, analisis, apuesta, equipos, ev')
    .ilike('equipos', `%${partido.equipos.split(' vs ')[0]}%`)
    .order('timestamp', { ascending: false })
    .limit(5);
  return data || [];
}
