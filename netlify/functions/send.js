exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Seguridad: solo permitir desde tu dominio Netlify
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
    value, timing, notes
  } = data;

  // Seguridad: validación del código secreto
  const secretCode = 'PunterX2025';
  if (authCode !== secretCode) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Código de acceso incorrecto.' })
    };
  }

  let message = `📌 *${sport||'-'}*\n🏟️ *Evento:* ${match||'-'}\n🗓️ *Fecha:* ${date||'-'}\n🎯 *Apuesta:* ${bettype||'-'}\n💸 *Cuota:* ${odds||'-'}\n📈 *Confianza:* ${confidence||'-'}\n📝 *Resumen:* ${brief||'-'}\n`;

  const isVIP = !!(detailed || alternatives || bookie || value || timing || notes);

  if (isVIP) {
    message += `\n🔒 *ANÁLISIS VIP*\n`;
    if (detailed) message += `📊 *Análisis:* ${detailed}\n`;
    if (alternatives) message += `➕ *Alternativas:* ${alternatives}\n`;
    if (bookie) message += `🏦 *Bookie:* ${bookie}\n`;
    if (value) message += `💎 *Valor:* ${value}\n`;
    if (timing) message += `⏱️ *Timing:* ${timing}\n`;
    if (notes) message += `📌 *Notas:* ${notes}\n`;
  }

  const botToken = '8494607323:AAHjK3wF_lk4EFojFyoaoOcVbhVrn3_OdCQ';
  const chatId = isVIP ? '-1002861902996' : '@punterxpicks';
  const sendUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram error: ${response.statusText}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Mensaje enviado correctamente.' })
    };
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error al enviar mensaje a Telegram.' })
    };
  }
};
