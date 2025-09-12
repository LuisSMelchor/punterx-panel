'use strict';

/**
 * send.cjs — STUB de envío para entorno local/preview (Netlify Dev)
 * Compatibilidad:
 *   - Netlify Dev (lambda-local): exports.handler(event) -> {statusCode, body}
 *   - Bundlers v2: module.exports.default = handler (mismo handler)
 * Helpers expuestos como props del handler: tgSendMessage, tgSendDM, tgCreateInviteLink,
 * sendVIP, sendFree, formatMessage, formatPick, expulsarUsuarioVIP.
 * Respeta: SEND_TELEGRAM y PUBLISH_PREVIEW_ONLY (por defecto: no publica).
 */

const asBool = (v) => {
  const s = (v == null ? '' : String(v)).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
};

function formatMessage({ title, text, html, ev } = {}) {
  return {
    title: title || null,
    text: text || (html ? null : ''),
    html: html || null,
    ev: (ev != null ? Number(ev) : null),
  };
}

function formatPick(pick = {}) {
  const { league, match, market, odds, ev } = pick || {};
  return { league, match, market, odds, ev: (ev != null ? Number(ev) : null) };
}

// Simulación básica de envío (no publica en local/preview salvo que SEND_TELEGRAM=1 y PUBLISH_PREVIEW_ONLY=0)
async function _send({ channel, text, html, title, ev, previewNote } = {}) {
  const SEND_TELEGRAM = asBool(process.env.SEND_TELEGRAM || '0');
  const PREVIEW_ONLY  = asBool(process.env.PUBLISH_PREVIEW_ONLY || '1');

  const payload = {
    ok: true,
    channel: channel || 'free',
    title: title || null,
    text: text || null,
    html: html || null,
  };
  if (ev != null) payload.ev = Number(ev);

  // En dev/preview, devolvemos preview:true
  payload.preview = (!SEND_TELEGRAM || PREVIEW_ONLY);
  if (previewNote) payload.note = previewNote;

  // Aquí podrías integrar realmente Telegram si quisieras en local.
  return payload;
}

// --- Helpers (mantenemos nombres esperados por el impl) ---
async function tgSendMessage({ channel = 'free', text, html, title, ev } = {}) {
  return _send({ channel, text, html, title, ev, previewNote: 'tgSendMessage' });
}

async function tgSendDM(user, { text, html, title, ev } = {}) {
  const note = `tgSendDM(${user || 'unknown'})`;
  return _send({ channel: 'dm', text, html, title, ev, previewNote: note });
}

async function tgCreateInviteLink({ ttlSeconds = 3600, memberLimit = 1 } = {}) {
  // Stub de invitación
  const preview = (!asBool(process.env.SEND_TELEGRAM || '0') || asBool(process.env.PUBLISH_PREVIEW_ONLY || '1'));
  return {
    ok: true,
    preview,
    invite_link: 'https://t.me/+stub_invite',
    ttl: Number(ttlSeconds) || 3600,
    limit: Number(memberLimit) || 1,
  };
}

async function expulsarUsuarioVIP(userIdOrUsername) {
  const preview = (!asBool(process.env.SEND_TELEGRAM || '0') || asBool(process.env.PUBLISH_PREVIEW_ONLY || '1'));
  return { ok: true, preview, kicked: String(userIdOrUsername || '') };
}

async function sendVIP({ text, html, title, ev } = {}) {
  return _send({ channel: 'vip', text, html, title, ev, previewNote: 'sendVIP' });
}

async function sendFree({ text, html, title, ev } = {}) {
  return _send({ channel: 'free', text, html, title, ev, previewNote: 'sendFree' });
}

// --- Handler HTTP clásico (compatible con Netlify Dev / lambda-local) ---
async function httpHandler(event /*, context */) {
  let body = {};
  try {
    if (event && event.body) body = JSON.parse(event.body);
  } catch (_) { body = {}; }

  const msg = formatMessage(body || {});
  const channel = (body && body.channel) || 'free';

  const res = await tgSendMessage({ channel, ...msg });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(res),
  };
}

// Export dual: CommonJS (exports.handler) y default (para bundlers que miran default)
const handler = httpHandler;

// Adjuntar helpers como propiedades del handler (para require('../send.cjs') en otros módulos)
Object.assign(handler, {
  tgSendMessage,
  tgSendDM,
  tgCreateInviteLink,
  expulsarUsuarioVIP,
  sendVIP,
  sendFree,
  formatMessage,
  formatPick,
});

module.exports = handler;
module.exports.handler = handler;
module.exports.default = handler;
exports.handler = handler;
