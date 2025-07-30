const crypto = require("crypto");
const https = require("https");

exports.handler = async function(event, context) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const bodyRaw = event.body || "";
    if (!bodyRaw) return { statusCode: 400, body: 'Cuerpo vacío recibido' };

    const body = JSON.parse(bodyRaw);

    // 🛑 Honeypot: detectar bots
    if (body.honeypot && body.honeypot.length > 0) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Bot detectado (honeypot)" })
      };
    }

    // ✅ Validar origen
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
      authCode, sport, event: match, date, bettype,
      odds, confidence, brief,
      detailed, alternatives, bookie,
      value, timing, notes,
      timestamp, signature
    } = body;

    // ✅ Validar authCode
    const secretCode = 'PunterX2025';
    if (authCode !== secretCode) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Código de acceso incorrecto.' })
      };
    }

    // 🔐 Validar firma HMAC
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

    // 🧠 Generar mensaje para Telegram
    const message = `📌 *${sport || '-'}*\n` +
      `🏟️ *Evento:* ${match || '-'}\n` +
      `🗓️ *Fecha:* ${date || '-'}\n` +
      `🎯 *Apuesta:* ${bettype || '-'}\n` +
      `💵 *Cuota:* ${odds || '-'}\n` +
      `📈 *Confianza:* ${confidence || '-'}\n\n` +
      `🧠 *Resumen:* ${brief || '-'}\n\n` +
      `${detailed || '-'}\n\n` +
      `🔁 *Alternativa:* ${alternatives || '-'}\n` +
      `📚 *Bookie:* ${bookie || '-'}\n` +
      `📍 *Valor:* ${value || '-'}\n` +
      `⏱️ *Timing:* ${timing || '-'}\n` +
      `📝 *Notas:* ${notes || '-'}`;

    // 📤 Enviar a Telegram
    const TELEGRAM_TOKEN = `${process.env.TELEGRAM_BOT_TOKEN}`.trim();
    const TELEGRAM_CHAT_ID = `${process.env.TELEGRAM_CHAT_ID}`.trim();

    const payload = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
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
