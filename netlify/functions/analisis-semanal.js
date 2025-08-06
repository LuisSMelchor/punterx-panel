const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function obtenerUltimos100Picks() {
  const { data, error } = await supabase
    .from('memoria_ia')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100);

  if (error) throw new Error('Error al consultar picks: ' + error.message);
  return data;
}

function calcularEstadisticas(picks) {
  const total = picks.length;
  const porNivel = {};
  const porLiga = {};
  let ganados = 0;

  picks.forEach(pick => {
    const nivel = pick.nivel || 'Sin nivel';
    porNivel[nivel] = (porNivel[nivel] || 0) + 1;

    const liga = pick.liga || 'Desconocida';
    porLiga[liga] = (porLiga[liga] || 0) + 1;

    if (pick.acierto === true) ganados++;
  });

  const porcentaje = total > 0 ? ((ganados / total) * 100).toFixed(1) : '0.0';
  return { total, ganados, porcentaje, porNivel, porLiga };
}

function formatearMensaje({ total, ganados, porcentaje, porNivel, porLiga }) {
  const topLigas = Object.entries(porLiga)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([liga, cantidad]) => `- ${liga}: ${cantidad} picks`)
    .join('\n');

  const niveles = Object.entries(porNivel)
    .map(([nivel, cantidad]) => `- ${nivel}: ${cantidad}`)
    .join('\n');

  return `
📊 *Resumen semanal de rendimiento*

✅ Picks ganados: *${ganados}* de *${total}*
📈 Porcentaje de acierto: *${porcentaje}%*

🎯 Picks por nivel:
${niveles}

🌍 Ligas más frecuentes:
${topLigas}

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.

⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable.
`.trim();
}

async function enviarMensaje(mensaje) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHANNEL_ID,
    text: mensaje,
    parse_mode: 'Markdown'
  };

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error('Error al enviar mensaje: ' + errorData);
  }
}

exports.handler = async () => {
  try {
    const picks = await obtenerUltimos100Picks();
    const estadisticas = calcularEstadisticas(picks);
    const mensaje = formatearMensaje(estadisticas);
    await enviarMensaje(mensaje);

    return {
      statusCode: 200,
      body: 'Resumen semanal enviado con éxito.'
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: 'Error en resumen semanal: ' + error.message
    };
  }
};
