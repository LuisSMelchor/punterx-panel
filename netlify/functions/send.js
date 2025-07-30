const crypto = require("crypto");

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

    const validOrigins = ['https://punterx-panel-vip.netlify.app'];
    const origin = event.headers.origin || event.headers.referer || '';
    if (!validOrigins.some(valid => origin.includes(valid))) {
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

    let message = `📌 *${sport||'-'}*\n🏟️ *Evento:* ${match||'-'}\n🗓️ *Fecha:* ${date||'-'}\n🎯 *Apuesta:* ${bettype||'-'}\n💵 *Cuota:* ${odds||'-'}\n📈 *Confianza:* ${confidence||'-'}\n\n🧠 *Resumen:* ${brief||'-'}\n\n${detailed}\n\n🔁 *Alternativa:* ${alternatives||'-'}\n📚 *Bookie:* ${bookie||'-'}\n📍 *Valor:* ${value||'-'}\n⏱️ *Timing:* ${timing||'-'}\n📝 *Notas:* ${notes||'-'}`;

    console.log("✅ Mensaje listo para Telegram:");
    console.log(message);

    return {
      statusCode: 200,
      body: "Mensaje validado correctamente. Listo para enviar (simulado)."
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: `❌ Error interno en send: ${err.message}`
    };
  }
};
