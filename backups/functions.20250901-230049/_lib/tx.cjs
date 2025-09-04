'use strict';

// Ponyfill de fetch
const fetchPony = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({default: f}) => f(...args)));

const MAX_LEN = 4096;

/**
 * Envía texto a Telegram. Admite chatId tipo @canal o -100...
 * - Corta en trozos de ~4000 para no rebasar 4096
 * - Devuelve { ok, sent, parts, errors }
 */
async function sendTelegramText({ chatId, text }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok:false, reason:'missing-telegram-token' };
  if (!chatId) return { ok:false, reason:'missing-chat-id' };
  if (!text || typeof text !== 'string') return { ok:false, reason:'empty-text' };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const parts = [];
  for (let i = 0; i < text.length; i += 4000) {
    parts.push(text.slice(i, i + 4000));
  }

  const sent = [];
  const errors = [];
  for (const part of parts) {
    const r = await fetchPony(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: 'Markdown' // plano; si quieres desactivar, quítalo
      })
    });
    if (!r.ok) {
      const raw = await r.text().catch(()=>null);
      errors.push({ status: r.status, raw });
    } else {
      const json = await r.json().catch(()=>null);
      sent.push(json);
    }
  }
  return { ok: errors.length === 0, sent, parts: parts.length, errors };
}

module.exports = { sendTelegramText };
