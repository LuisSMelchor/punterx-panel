const crypto = require('crypto');

const TELEGRAM_GROUP_ID = process.env.TELEGRAM_GROUP_ID;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.PUNTERX_SECRET;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body);
    const {
      authCode,
      timestamp,
      honeypot,
      origin,
      mensaje, // <- nuevo formato
      deporte,
      evento,
      fecha,
      hora,
      cuota,
      confianza,
      analisis_basico,
      analisis_profesional,
      valor,
      alternativa,
      timing,
      notas,
      apuesta
    } = body;

    // 🛡️ Seguridad
    if (honeypot || origin !== 'https://punterx-panel-vip.netlify.app' || authCode !== 'PunterX2025') {
      return { statusCode: 403, body: 'Acceso denegado' };
    }

    if (!timestamp) {
      return { statusCode: 400, body: 'Falta timestamp' };
    }

    const signature = event.headers['x-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', SECRET)
      .update(event.body)
      .digest('hex');

    if (signature !== expectedSignature) {
      return { statusCode: 403, body: 'Firma inválida' };
    }

    // 📢 Armar mensaje final (nuevo sistema con 'mensaje', o antiguo con campos separados)
    let mensajeFinal;

    if (mensaje) {
      // 🎯 Nuevo sistema con mensaje generado por OpenAI ya formateado
      mensajeFinal = mensaje;
    } else {
      // 🧠 Formato antiguo
      const esVIP = !!(analisis_profesional || apuesta || valor || notas);

      mensajeFinal = `📌 Deporte: ${deporte}\n`;
      mensajeFinal += `🆚 Evento: ${evento}\n`;
      mensajeFinal += `📆 Fecha: ${fecha} | 🕒 ${hora} (CDMX)\n`;
      mensajeFinal += `💵 Cuota: ${cuota} (promedio estimado del mercado)\n`;
      mensajeFinal += `📈 Confianza: ${confianza}\n`;

      if (esVIP) {
        mensajeFinal += `📊 Valor detectado: ${valor}\n\n`;
        mensajeFinal += `🧠 Análisis Profesional:\n${analisis_profesional}\n\n`;
        if (notas) mensajeFinal += `📝 Notas adicionales: ${notas}\n\n`;
        mensajeFinal += `💡 Apuesta sugerida: ${apuesta}\n\n`;
        mensajeFinal += `📈 Análisis validado por el equipo + IA avanzada PunterX`;
      } else {
        mensajeFinal += `\n🧠 Análisis Estratégico:\n${analisis_basico}\n\n`;
        mensajeFinal += `📌 _¿La apuesta sugerida? Disponible solo en el grupo VIP_\n\n`;
        mensajeFinal += `🚀 Únete a nuestro grupo VIP y recibe análisis completos + apuestas sugeridas de valor.\n👉 https://t.me/+qmgqwj5tZVM2NDQx`;
      }
    }

    // 📤 Envío a Telegram
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const esVIP = !!(analisis_profesional || apuesta || valor || notas) || !!(mensaje && mensaje.includes("PICK NIVEL:"));
    const chatId = esVIP ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensajeFinal,
        parse_mode: 'Markdown'
      })
    });

    const data = await res.json();

    return {
      statusCode: 200,
      body: `✅ Mensaje enviado a Telegram: ${JSON.stringify(data)}`
    };
  } catch (err) {
    console.error('❌ Error:', err);
    return { statusCode: 500, body: 'Error interno del servidor' };
  }
};
