// ✅ ARCHIVO: netlify/functions/send.js
// ✅ Funcional: SOLO envía al grupo VIP
// ⚠️ NO TOCAR esto hasta tener todo estable

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

    if (body.honeypot && body.honeypot.length > 0) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Bot detectado (honeypot)" })
      };
    }

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
      authCode, sport, match, date, bettype,
      odds, confidence, brief,
      detailed, alternatives, bookie,
      value, timing, notes,
      timestamp, signature
    } = body;

    const secretCode = 'PunterX2025';
    if (authCode !== secretCode) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Código de acceso incorrecto.' })
      };
    }

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

    const message = `\ud83d\udccc *${sport || '-'}*\n` +
      `\ud83c\udfdf\ufe0f *Evento:* ${match || '-'}\n` +
      `\ud83d\uddd3\ufe0f *Fecha:* ${date || '-'}\n` +
      `\ud83c\udfaf *Apuesta:* ${bettype || '-'}\n` +
      `\ud83d\udcb5 *Cuota:* ${odds || '-'}\n` +
      `\ud83d\udcc8 *Confianza:* ${confidence || '-'}\n\n` +
      `\ud83e\udde0 *Resumen:* ${brief || '-'}\n\n` +
      `${detailed || '-'}\n\n` +
      `\ud83d\udd01 *Alternativa:* ${alternatives || '-'}\n` +
      `\ud83d\udcda *Bookie:* ${bookie || '-'}\n` +
      `\ud83d\udccd *Valor:* ${value || '-'}\n` +
      `\u23f1\ufe0f *Timing:* ${timing || '-'}\n` +
      `\ud83d\udcdd *Notas:* ${notes || '-'}`;

    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_GROUP_ID; // ⚠️ SOLO GRUPO VIP

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
      body: `\u2705 Mensaje enviado a Telegram: ${telegramResponse}`
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `\u274c Error interno en send: ${err.message}`
    };
  }
};
