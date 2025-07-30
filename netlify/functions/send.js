const crypto = require("crypto");

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const body = JSON.parse(event.body);

  // 🛑 Honeypot: detectar bots
  if (body.honeypot && body.honeypot.length > 0) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "Bot detectado (honeypot)" })
    };
  }

  // 🛑 Origen válido
  const validOrigins = ['https://punterx-panel-vip.netlify.app'];
  const origin = event.headers.origin || event.headers.referer || '';
  if (!validOrigins.some(valid => origin.includes(valid))) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Origen no autorizado.' })
    };
  }

  const data = JSON.parse(event.body);
  const {
    authCode, sport, event: match, date, bettype,
    odds, confidence, brief,
    detailed, alternatives, bookie,
    value, timing, notes,
    timestamp, signature
  } = data;

  // 🔐 Código secreto para el panel
  const secretCode = 'PunterX2025';

  // 🔒 Validación de código de acceso
  if (authCode !== secretCode) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Código de acceso incorrecto.' })
    };
  }

  // 🔐 Firma HMAC de tiempo (protección anti-scripts)
  const SECRET_KEY = 'X9$Gtp#zD3@LP82mR*vWj5Q!7bCk%N0y'; // No olvidar

  if (!timestamp || !signature) {
    return { statusCode: 400, body: 'Falta timestamp o firma' };
  }

  const now = Date.now();
  const MAX_DELAY = 30000; // 30 segundos

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

  // 🧠 Generar el mensaje
  let message = `📌 *${sport||'-'}*\n🏟️ *Evento:* ${match||'-'}\n🗓️ *Fecha:* ${date||'-'}\n🎯 *Apuesta:* ${bettype||'-'}\n
