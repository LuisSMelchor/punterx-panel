const crypto = require("crypto");
const https = require("https");

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const bodyRaw = event.body || "";
    if (!bodyRaw) return { statusCode: 400, body: 'Cuerpo vacío recibido' };

    const body = JSON.parse(bodyRaw);

    // 🚫 Honeypot
    if (body.honeypot && body.honeypot.length > 0) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Bot detectado (honeypot)" })
      };
    }

    // 🌐 Origen
    const validOrigins = [
      'https://punterx-panel-vip.netlify.app',
      undefined,
      ''
    ];
    const origin = event.headers.origin || event.headers.referer || '';
    if (!validOrigins.some(valid => origin?.includes?.(valid))) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Origen no autorizado.' })
      };
    }

    const {
  authCode,
  deporte: sport,
  evento: match,
  fecha: date,
  apuesta: bettype,
  cuota: odds,
  confianza: confidence,
  resumen: brief,
  detallado: detailed = brief,
  alternativa: alternatives,
  bookie,
  valor: value,
  timing,
  notas: notes
} = body;

// 🔐 Extraer timestamp y signature desde los headers
const timestamp = event.headers['timestamp'];
const signature = event.headers['x-signature'];

    // 🔐 Código de acceso
    if (authCode !== 'PunterX2025') {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Código de acceso incorrecto.' })
      };
    }

    // 🔐 Validación HMAC
    const SECRET_KEY = process.env.PUNTERX_SECRET;
    if (!timestamp || !signature) {
      return { statusCode: 400, body: 'Falta timestamp o firma' };
    }

    const now = Date.now();
    const MAX_DELAY = 30000;
    if (Math.abs(now - parseInt(timestamp)) > MAX_DELAY) {
      return { statusCode: 403, body: 'Solicitud expirada' };
    }

    const expectedSignature = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(timestamp.toString())
      .digest("hex");

    if (signature !== expectedSignature) {
      return { statusCode: 401, body: 'Firma inválida' };
    }

    // 🧠 Lógica VIP vs Gratuito
    const hasVIP = [detailed, alternatives, bookie, value, timing, notes].some(v => v && v.trim());
    const chatId = hasVIP
      ? process.env.TELEGRAM_GROUP_ID
      : process.env.TELEGRAM_CHANNEL_ID;

    // 📋 LOGS para depuración
    console.log("✅ Tipo de pick:", hasVIP ? "VIP" : "Gratuito");
    console.log("📤 chatId usado:", chatId);
    console.log("📦 process.env.TELEGRAM_GROUP_ID:", process.env.TELEGRAM_GROUP_ID);
    console.log("📦 process.env.TELEGRAM_CHANNEL_ID:", process.env.TELEGRAM_CHANNEL_ID);

    // 🧾 Construcción del mensaje
    let message =
      `📌 *${sport || '-'}*\n` +
      `🏟️ *Evento:* ${match || '-'}\n` +
      `📅 *Fecha:* ${date || '-'}\n` +
      `🎯 *Apuesta:* ${bettype || '-'}\n` +
      `💵 *Cuota:* ${odds || '-'}\n` +
      `📈 *Confianza:* ${confidence || '-'}\n\n` +
      `🧠 *Resumen:* ${brief || '-'}\n\n`;

    if (hasVIP) {
      message +=
        `${detailed || '-'}\n\n` +
        `🔁 *Alternativa:* ${alternatives || '-'}\n` +
        `📚 *Bookie:* ${bookie || '-'}\n` +
        `📍 *Valor:* ${value || '-'}\n` +
        `⏱️ *Timing:* ${timing || '-'}\n` +
        `📝 *Notas:* ${notes || '-'}`;
    }

    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

    const payload = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown"
    });

    const telegramOptions = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const telegramResponse = await new Promise((resolve, reject) => {
      const req = https.request(telegramOptions, res => {
        let data = '';
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    return {
      statusCode: 200,
      body: `✅ Mensaje enviado a Telegram: ${telegramResponse}`
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `❌ Error interno en send: ${err.message}`
    };
  }
};

// al final del archivo
// 😄 Comentario temporal para forzar redeploy
