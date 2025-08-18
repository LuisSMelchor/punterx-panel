// netlify/functions/tg_trial_webhook.cjs
const { tgSendMessage } = require('./send.js'); // usa tu helper existente

const VERSION = 'tg_trial_webhook v1.0 (echo-only)';

exports.handler = async (event) => {
  try {
    console.log(`[${VERSION}] method=${event && event.httpMethod}`);
    if (!event || event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
      const preview = (event.body || '').slice(0, 160).replace(/\s+/g, ' ');
      console.log(`[${VERSION}] body[0..160]= ${preview}`);
    } catch (e) {
      console.log(`[${VERSION}] bad json`, e && e.message);
      return { statusCode: 200, body: 'bad json' };
    }

    // SOLO aceptamos update.message de chat PRIVADO con texto
    if (!update || !Object.prototype.hasOwnProperty.call(update, 'message')) {
      console.log(`[${VERSION}] ignored: no "message" field`);
      return { statusCode: 200, body: 'ignored' };
    }
    const msg = update.message;
    if (!msg || typeof msg !== 'object') {
      console.log(`[${VERSION}] ignored: message not object`);
      return { statusCode: 200, body: 'ignored' };
    }
    const chat = msg.chat;
    if (!chat || chat.type !== 'private') {
      console.log(`[${VERSION}] ignored: not private chat`);
      return { statusCode: 200, body: 'ignored' };
    }
    if (!Object.prototype.hasOwnProperty.call(msg, 'text') || typeof msg.text !== 'string' || msg.text.trim() === '') {
      console.log(`[${VERSION}] ignored: missing "text"`);
      return { statusCode: 200, body: 'ignored' };
    }

    const chatId = chat.id;           // ✅ en privados, chat.id identifica al usuario
    const text = msg.text.trim();     // nunca tocamos msg.from
    console.log(`[${VERSION}] will echo. chatId=${chatId} text=${text}`);

    // Respuesta de prueba (echo). Si esto funciona, ya el enrutamiento y parseo están bien.
    await tgSendMessage(chatId, `Echo PunterX: ${text}`);
    console.log(`[${VERSION}] echo sent`);

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] webhook error`, e);
    return { statusCode: 200, body: 'error' };
  }
};
