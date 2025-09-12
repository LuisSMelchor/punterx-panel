'use strict';

/**
 * STUB de envío para entorno local/preview.
 * - Compatibilidad con Netlify v2 (Fetch): return Response.
 * - Mantiene helpers (tgSendMessage, sendVIP, etc.) como props del default export.
 * - Respeta SEND_TELEGRAM y PUBLISH_PREVIEW_ONLY.
 */

const asBool = (v) => v === '1' || v === 'true' || v === 'yes';

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

// Simulación básica de envío (no publica en local/preview)
async function _send({ channel, text, html, title, ev, previewNote } = {}) {
  const SEND_TELEGRAM = asBool(process.env.SEND_TELEGRAM || '0');
  const PREVIEW_ONLY  = asBool(process.env.PUBLISH_PREVIEW_ONLY || '1');

  const payload = { ok: true, channel, title: title || null, text: text || null, html: html || null };
  if (ev != null) payload.ev = Number(ev);

  if (!SEND_TELEGRAM || PREVIEW_ONLY) {
    payload.preview = true;
    payload.note = previewNote || 'no publish (local/preview)';
    return payload;
  }

  // Aquí iría el envío real a Telegram.
  payload.sent = true;
  payload.provider = 'telegram';
  return payload;
}

async function tgSendMessage({ channel = 'free', text, html, title, ev } = {}) {
  return _send({ channel, text, html, title, ev, previewNote: 'tgSendMessage' });
}

async function tgSendDM({ userId, text, html, title } = {}) {
  return _send({ channel: `dm:${userId}`, text, html, title, previewNote: 'tgSendDM' });
}

async function tgCreateInviteLink({ expire_seconds = 3600 } = {}) {
  return {
    ok: true,
    preview: true,
    invite_link: `https://t.me/+stub_${Date.now()}`,
    expire_seconds,
  };
}

async function expulsarUsuarioVIP({ userId } = {}) {
  return { ok: true, preview: true, action: 'kick', userId };
}

async function sendVIP ({ text, html, title, ev } = {}) { return tgSendMessage({ channel: 'vip',  text, html, title, ev }); }
async function sendFree({ text, html, title, ev } = {}) { return tgSendMessage({ channel: 'free', text, html, title, ev }); }

// ================= Handler Netlify v2 (Fetch) =================
function jres(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function httpHandler(request) {
  try {
    if (request.method === 'GET') {
      return jres({ ok: true, ping: 'send.cjs', preview: asBool(process.env.PUBLISH_PREVIEW_ONLY || '1') });
    }
    if (request.method !== 'POST') {
      return jres({ ok: false, error: 'method-not-allowed' }, 405);
    }

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    const { channel = 'free', text, html, title, ev } = body || {};
    const res = await tgSendMessage({ channel, text, html, title, ev });
    return jres(res, 200);
  } catch (e) {
    return jres({ ok: false, error: e && (e.message || String(e)) }, 500);
  }
}

// Export default = handler con helpers como props (para require('../send.cjs'))
httpHandler.formatMessage       = formatMessage;
httpHandler.formatPick          = formatPick;
httpHandler.tgSendMessage       = tgSendMessage;
httpHandler.tgSendDM            = tgSendDM;
httpHandler.tgCreateInviteLink  = tgCreateInviteLink;
httpHandler.expulsarUsuarioVIP  = expulsarUsuarioVIP;
httpHandler.sendVIP             = sendVIP;
httpHandler.sendFree            = sendFree;

module.exports = httpHandler;
