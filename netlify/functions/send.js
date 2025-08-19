// netlify/functions/send.js
// Envío a Telegram (FREE/VIP) — robusto y con polyfill de fetch

try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID, // FREE
  TELEGRAM_GROUP_ID    // VIP
} = process.env;

const T_NET = 8000;

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally { clearTimeout(id); }
}

async function sendTelegram(text, tipo = 'free') {
  if (!TELEGRAM_BOT_TOKEN) return { ok:false, error:'TELEGRAM_BOT_TOKEN ausente' };
  const chat_id = (tipo === 'vip') ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!chat_id) return { ok:false, error:`chat_id ausente para tipo=${tipo}` };

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetchWithTimeout(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        chat_id,
        text: String(text || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    const data = await res.json().catch(()=>null);
    if (!res.ok || !data?.ok) {
      return { ok:false, status:res.status, error: data ? JSON.stringify(data).slice(0,200) : 'HTTP error' };
    }
    return { ok:true, data };
  } catch (e) {
    return { ok:false, error: e?.message || String(e) };
  }
}

function ok(body){ return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }; }
function html(){ return `<!doctype html><meta charset="utf-8">
<title>PunterX — Send</title>
<style>body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}.card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}</style>
<div class="card">
  <h1>send</h1>
  <p>POST JSON → {"text":"hola","tipo":"vip|free"}</p>
  <p>GET ping → ?ping=1</p>
</div>`; }

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    if (event.httpMethod === 'GET') {
      if (qs.ping) return { statusCode:200, headers:{'Content-Type':'text/plain; charset=utf-8'}, body:'pong' };
      return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body: html() };
    }
    if (event.httpMethod !== 'POST') return ok({ ok:false, error:'Use POST' });

    const ctype = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    let text='', tipo='free';
    if (ctype.includes('application/json')) {
      const body = JSON.parse(event.body || '{}');
      text = String(body.text || ''); tipo = String(body.tipo || 'free');
    } else if (ctype.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body || '');
      text = String(params.get('text') || ''); tipo = String(params.get('tipo') || 'free');
    } else {
      try {
        const body = JSON.parse(event.body || '{}');
        text = String(body.text || ''); tipo = String(body.tipo || 'free');
      } catch { return ok({ ok:false, error:'Body no reconocido; usa JSON o form-urlencoded' }); }
    }
    if (!text) return ok({ ok:false, error:'Falta "text"' });

    const r = await sendTelegram(text, (tipo === 'vip' ? 'vip' : 'free'));
    return ok(r);
  } catch (e) {
    return ok({ ok:false, error: e?.message || String(e) });
  }
};

// =======================================================
// ===============  PunterX · LIVE helpers  ===============
// =======================================================
"use strict";

try { if (typeof fetch === "undefined") global.fetch = require("node-fetch"); } catch (_) {}

const _TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const _TG_FREE  = process.env.TELEGRAM_CHANNEL_ID; // Canal gratuito
const _TG_VIP   = process.env.TELEGRAM_GROUP_ID;   // Grupo VIP

// -- Utilidades de formato --
function _fmt(str, map) {
  let out = String(str || "");
  for (const [k, v] of Object.entries(map || {})) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v ?? ""));
  }
  return out;
}
function _renderBullets(arr) {
  const a = Array.isArray(arr) ? arr : [];
  if (!a.length) return "—";
  return a.map(s => `- ${s}`).join("\n");
}
function _renderTop3NoNumbers(top3) {
  const a = Array.isArray(top3) ? top3 : [];
  if (!a.length) return "—";
  // Elementos esperados: { bookie, price } (decimal). Primera casa en **negritas**
  return a.map((t, i) => {
    const line = `${t.bookie} — ${Number(t.price).toFixed(2)}`;
    return i === 0 ? `**${line}**` : line;
  }).join("\n");
}

// -- Cliente Telegram básico --
async function _tg(method, body) {
  const url = `https://api.telegram.org/bot${_TG_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`[Telegram ${method}] ${res.status} ${json.description || ""}`);
  }
  return json.result;
}
async function _sendText(chatId, text, { pin=false } = {}) {
  const msg = await _tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
  if (pin) {
    try {
      await _tg("pinChatMessage", {
        chat_id: chatId,
        message_id: msg.message_id,
        disable_notification: true
      });
    } catch (e) {
      // Si no hay permisos de admin para fijar, solo registrar y continuar.
      console.warn("[pinChatMessage]", e.message || e);
    }
  }
  return msg; // incluye message_id
}
async function _editText(chatId, messageId, text) {
  return _tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  });
}

// ===================
// Plantillas EN VIVO
// ===================

// FREE (LIVE_FREE)
const _TPL_LIVE_FREE = [
  "🔴 EN VIVO - RADAR DE VALOR",
  "🏆 {pais} - {liga} - {equipos}",
  "⏱️ {minuto}  |  Marcador: {marcador}  |  Fase: {fase}",
  "",
  "📊 Análisis en tiempo real:",
  "{razonamiento}",
  "",
  "💬 “En vivo, cada jugada puede cambiarlo todo. Aquí es donde nacen las oportunidades.”",
  "",
  "🎁 Únete al VIP para ver:",
  "- Apuesta sugerida y apuestas extra",
  "- EV y probabilidad estimada",
  "- Top-3 casas con la mejor cuota",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder."
].join("\n");

// VIP (LIVE_VIP) — sin numeración en top-3; #1 en negritas
const _TPL_LIVE_VIP = [
  "🔴 LIVE PICK - {nivel}",
  "🏆 {pais} - {liga} - {equipos}",
  "⏱️ {minuto}  |  Marcador: {marcador}  |  Fase: {fase}",
  "",
  "EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}",
  "",
  "💡 Apuesta sugerida: {apuesta_sugerida}",
  "📌 Vigencia: {vigencia}",
  "",
  "Apuestas extra:",
  "{apuestas_extra}",
  "",
  "📊 Razonamiento EN VIVO:",
  "{razonamiento}",
  "",
  "🏆 Top-3 casas (mejor resaltada):",
  "{top3}",
  "",
  "🧭 Snapshot mercado:",
  "{snapshot}",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder."
].join("\n");

// ============================
// Plantillas PRE-MATCH (NEW)
// ============================

// FREE PRE
const _TPL_PRE_FREE = [
  "📡 RADAR DE VALOR",
  "🏆 {pais} - {liga} - {equipos}",
  "🕒 Inicio: {kickoff}",
  "",
  "📊 Análisis:",
  "{analisis}",
  "",
  "🎁 Únete al VIP para ver:",
  "- EV y probabilidad estimada",
  "- Apuesta sugerida + Apuestas extra",
  "- Top-3 casas con mejor cuota",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo."
].join("\n");

// VIP PRE
const _TPL_PRE_VIP = [
  "🎯 PICK {nivel}",
  "🏆 {pais} - {liga} - {equipos}",
  "🕒 Inicio: {kickoff}",
  "",
  "EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}",
  "",
  "💡 Apuesta sugerida: {apuesta_sugerida}",
  "",
  "Apuestas extra:",
  "{apuestas_extra}",
  "",
  "🏆 Top-3 casas (mejor resaltada):",
  "{top3}",
  "",
  "📊 Datos avanzados:",
  "{datos}",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo."
].join("\n");

// ============================
// Plantillas OUTRIGHTS (NEW)
// ============================

// FREE OUTRIGHT
const _TPL_OUT_FREE = [
  "📡 RADAR DE VALOR — OUTRIGHT",
  "🏆 {pais} - {liga} - {mercado}",
  "",
  "📊 Análisis:",
  "{analisis}",
  "",
  "🎁 Únete al VIP para ver EV, probabilidad y mejores casas.",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo."
].join("\n");

// VIP OUTRIGHT
const _TPL_OUT_VIP = [
  "🎯 PICK OUTRIGHT {nivel}",
  "🏆 {pais} - {liga} - {mercado}",
  "",
  "EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}",
  "",
  "💡 Apuesta sugerida: {apuesta_sugerida}",
  "",
  "Apuestas extra:",
  "{apuestas_extra}",
  "",
  "🏆 Top-3 casas (mejor resaltada):",
  "{top3}",
  "",
  "🔎 IA Avanzada, monitoreando el mercado global 24/7.",
  "⚠️ Este contenido es informativo. Apostar conlleva riesgo."
].join("\n");

// ========================
// Builders de texto LIVE
// ========================
function _buildLiveFreeMessage(payload) {
  const razonamiento = _renderBullets(payload.razonamiento || []);
  return _fmt(_TPL_LIVE_FREE, {
    pais: payload.pais || "—",
    liga: payload.liga || "—",
    equipos: payload.equipos || "—",
    minuto: payload.minuto || "—",
    marcador: payload.marcador || "—",
    fase: payload.fase || "—",
    razonamiento
  });
}

function _buildLiveVipMessage(payload) {
  const apuestas_extra = _renderBullets(payload.apuestas_extra || []);
  const top3 = _renderTop3NoNumbers(payload.top3 || []);
  const snapshot = payload.snapshot || "—";
  return _fmt(_TPL_LIVE_VIP, {
    nivel: payload.nivel || "🥈 Avanzado",
    pais: payload.pais || "—",
    liga: payload.liga || "—",
    equipos: payload.equipos || "—",
    minuto: payload.minuto || "—",
    marcador: payload.marcador || "—",
    fase: payload.fase || "—",
    ev: (payload.ev ?? "").toString(),
    probabilidad: (payload.probabilidad ?? "").toString(),
    momio: (payload.momio ?? "").toString(),
    apuesta_sugerida: payload.apuesta_sugerida || "—",
    vigencia: payload.vigencia || "—",
    apuestas_extra,
    razonamiento: _renderBullets(payload.razonamiento || []),
    top3,
    snapshot
  });
}

// ============================
// Builders PRE-MATCH (NEW)
// ============================
function _buildPreFreeMessage(p) {
  return _fmt(_TPL_PRE_FREE, {
    pais: (p.pais || "—"),
    liga: (p.liga || "—"),
    equipos: (p.equipos || "—"),
    kickoff: (p.kickoff || "—"),
    analisis: _renderBullets((p.analisis || "").split("\n").filter(Boolean))
  });
}

function _buildPreVipMessage(p) {
  const apuestas_extra = _renderBullets(p.apuestas_extra || []);
  const top3 = _renderTop3NoNumbers(p.top3 || []);
  const datos = _renderBullets(p.datos || [
    p.clima ? `Clima: ${p.clima}` : null,
    p.arbitro ? `Árbitro: ${p.arbitro}` : null,
    p.historial ? `Historial: ${p.historial}` : null,
    p.xg ? `xG: ${p.xg}` : null
  ].filter(Boolean));
  return _fmt(_TPL_PRE_VIP, {
    nivel: p.nivel || "🥈 Avanzado",
    pais: p.pais || "—",
    liga: p.liga || "—",
    equipos: p.equipos || "—",
    kickoff: p.kickoff || "—",
    ev: (p.ev ?? "").toString(),
    probabilidad: (p.probabilidad ?? "").toString(),
    momio: (p.momio ?? "").toString(),
    apuesta_sugerida: p.apuesta_sugerida || "—",
    apuestas_extra,
    top3,
    datos
  });
}

// ============================
// Builders OUTRIGHTS (NEW)
// ============================
function _buildOutFreeMessage(p) {
  return _fmt(_TPL_OUT_FREE, {
    pais: p.pais || "—",
    liga: p.liga || "—",
    mercado: p.mercado || "—",
    analisis: _renderBullets((p.analisis || "").split("\n").filter(Boolean))
  });
}
function _buildOutVipMessage(p) {
  const apuestas_extra = _renderBullets(p.apuestas_extra || []);
  const top3 = _renderTop3NoNumbers(p.top3 || []);
  return _fmt(_TPL_OUT_VIP, {
    nivel: p.nivel || "🥈 Avanzado",
    pais: p.pais || "—",
    liga: p.liga || "—",
    mercado: p.mercado || "—",
    ev: (p.ev ?? "").toString(),
    probabilidad: (p.probabilidad ?? "").toString(),
    momio: (p.momio ?? "").toString(),
    apuesta_sugerida: p.apuesta_sugerida || "—",
    apuestas_extra,
    top3
  });
}

// =========================
// API pública (exports)
// =========================
module.exports.sendLiveFree = async function sendLiveFree(payload) {
  if (!_TG_TOKEN || !_TG_FREE) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildLiveFreeMessage(payload);
  return _sendText(_TG_FREE, text, { pin: false });
};

module.exports.sendLiveVip = async function sendLiveVip(payload, { pin = true } = {}) {
  if (!_TG_TOKEN || !_TG_VIP) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_GROUP_ID");
  const text = _buildLiveVipMessage(payload);
  return _sendText(Number(_TG_VIP), text, { pin });
};

// Edita el mismo post (evita spam). chat: "VIP" | "FREE"
module.exports.editLiveMessage = async function editLiveMessage({ chat = "VIP", message_id, payload }) {
  if (!_TG_TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  const chatId = chat === "FREE" ? _TG_FREE : Number(_TG_VIP);
  if (!chatId) throw new Error("ChatId inválido para edición");
  const text = (chat === "FREE") ? _buildLiveFreeMessage(payload) : _buildLiveVipMessage(payload);
  return _editText(chatId, message_id, text);
};

// =========================
// PRE-MATCH (exports NEW)
// =========================
module.exports.sendFreePrematch = async function sendFreePrematch(p) {
  if (!_TG_TOKEN || !_TG_FREE) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildPreFreeMessage(p);
  return _sendText(_TG_FREE, text, { pin: false });
};

module.exports.sendVipPrematch = async function sendVipPrematch(p, { pin = false } = {}) {
  if (!_TG_TOKEN || !_TG_VIP) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_GROUP_ID");
  const text = _buildPreVipMessage(p);
  return _sendText(Number(_TG_VIP), text, { pin });
};

// =========================
// OUTRIGHTS (exports NEW)
// =========================
module.exports.sendFreeOutright = async function sendFreeOutright(p) {
  if (!_TG_TOKEN || !_TG_FREE) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildOutFreeMessage(p);
  return _sendText(_TG_FREE, text, { pin: false });
};

module.exports.sendVipOutright = async function sendVipOutright(p, { pin = false } = {}) {
  if (!_TG_TOKEN || !_TG_VIP) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_GROUP_ID");
  const text = _buildOutVipMessage(p);
  return _sendText(Number(_TG_VIP), text, { pin });
};

// === Helpers Telegram (ADD-ONLY) ===
const TG_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const VIP_CHAT_ID = process.env.TELEGRAM_VIP_GROUP_ID;

async function tgSendMessage(chatId, text, extra = {}) {
  const res = await fetch(`${TG_API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
  });
  const j = await res.json();
  if (!j.ok) console.error('tgSendMessage error', j);
  return j;
}

// === DM directos a usuarios y broadcast simple ===

// Enviar DM a un usuario por su tg_id
async function tgSendDM(tgId, text, extra = {}) {
  try {
    const res = await fetch(`${TG_API}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(tgId),
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra
      })
    });
    const j = await res.json();
    if (!j.ok) console.error('tgSendDM error', j);
    return j;
  } catch (e) {
    console.error('tgSendDM exception', e?.message || e);
    return { ok: false, error: e?.message || 'exception' };
  }
}

// Broadcast DM a varios tg_id (throttle ligero para no golpear rate limits)
async function tgBroadcastDM(tgIds = [], text, extra = {}) {
  const out = [];
  for (const id of Array.isArray(tgIds) ? tgIds : []) {
    // throttle ~60ms entre envíos
    /* eslint-disable no-await-in-loop */
    out.push(await tgSendDM(id, text, extra));
    await new Promise(r => setTimeout(r, 60));
    /* eslint-enable no-await-in-loop */
  }
  return out;
}

// Exportaciones incrementales (sin romper exports existentes)
exports.tgSendDM = tgSendDM;
exports.tgBroadcastDM = tgBroadcastDM;


async function tgCreateInviteLink(secondsValid = Number(process.env.TRIAL_INVITE_TTL_SECONDS) || 172800) {
  const expire = Math.floor(Date.now() / 1000) + secondsValid;
  const res = await fetch(`${TG_API}/createChatInviteLink`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: VIP_CHAT_ID,
      expire_date: expire,
      member_limit: 1
      // creates_join_request: false  // si deseas aprobación manual, cámbialo a true y maneja approveJoinRequest
    })
  });
  const j = await res.json();
  if (!j.ok) console.error('tgCreateInviteLink error', j);
  return j.result?.invite_link;
}

async function expulsarUsuarioVIP(userId) {
  // Ban para expulsar (y opcional unban para permitir re-join solo por invitación)
  const ban = await fetch(`${TG_API}/banChatMember`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: VIP_CHAT_ID, user_id: userId })
  });
  const bj = await ban.json();
  if (!bj.ok) console.error('banChatMember error', bj);

  // Unban opcional para limpiar estado (el reingreso sigue controlado por links de invitación de 1 uso)
  await fetch(`${TG_API}/unbanChatMember`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: VIP_CHAT_ID, user_id: userId, only_if_banned: true })
  });
}

module.exports = {
  ...module.exports,
  tgSendMessage,
  tgCreateInviteLink,
  expulsarUsuarioVIP
};
