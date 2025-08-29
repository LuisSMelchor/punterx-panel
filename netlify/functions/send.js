// netlify/functions/send.js
// Envío a Telegram (FREE/VIP) — robusto, sin duplicados y con utilidades para usuarios
"use strict";

try {
  if (typeof fetch === "undefined") {
    // Polyfill solo si hace falta
    global.fetch = require("node-fetch");
  }
} catch (_) {}

// =====================
// ENV unificadas
// =====================
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,     // FREE (canal)
  TELEGRAM_GROUP_ID,       // VIP (grupo) compat
  TELEGRAM_VIP_GROUP_ID    // VIP (grupo) preferente
} = process.env;

const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'PunterXBot';
const VIP_CHAT_ID = TELEGRAM_VIP_GROUP_ID || TELEGRAM_GROUP_ID || null;
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const T_NET = 8000;

// =====================
// NET helpers
// =====================
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally { clearTimeout(id); }
}

// =====================
// Telegram low-level
// =====================
async function tgCall(method, body) {
  const res = await fetchWithTimeout(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(`[Telegram ${method}] ${res.status} ${json.description || ""}`);
  }
  return json.result;
}

async function tgSendText(chatId, text, extra = {}) {
  return tgCall("sendMessage", {
    chat_id: chatId,
    text: String(text || ""),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

async function tgEditText(chatId, messageId, text, extra = {}) {
  return tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: String(text || ""),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra
  });
}

async function tgPin(chatId, messageId, disable_notification = true) {
  try {
    await tgCall("pinChatMessage", {
      chat_id: chatId,
      message_id: messageId,
      disable_notification
    });
  } catch (e) {
    console.warn("[pinChatMessage]", e.message || e);
  }
}

// ===================================================================
// Handler HTTP /send (TU LÓGICA ORIGINAL CONSERVADA, sin duplicaciones)
// ===================================================================
async function sendTelegram(text, tipo = "free") {
  if (!TELEGRAM_BOT_TOKEN) return { ok:false, error:"TELEGRAM_BOT_TOKEN ausente" };
  const chat_id = (tipo === "vip") ? VIP_CHAT_ID : TELEGRAM_CHANNEL_ID;
  if (!chat_id) return { ok:false, error:`chat_id ausente para tipo=${tipo}` };

  try {
    const data = await tgSendText(chat_id, text);
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
    if (event.httpMethod === "GET") {
      // ping simple
      if (qs.ping) return { statusCode:200, headers:{'Content-Type':'text/plain; charset=utf-8'}, body:"pong" };
      
      // acción admin: re‑publicar y fijar el mensaje con botón al bot en el canal FREE
      // uso: GET /.netlify/functions/send?pin=free  con header: x-auth-code: <AUTH_CODE>
      if (qs.pin === 'free') {
        const hdr = (event.headers && (event.headers['x-auth-code'] || event.headers['x-auth'])) || "";
        const expected = (process.env.AUTH_CODE || "");
        if (!expected || hdr !== expected) {
          return { statusCode: 403, headers:{'Content-Type':'text/plain; charset=utf-8'}, body: 'Forbidden' };
        }
        try {
          const msg = await sendPinnedFree({ pin: true });
          return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok:true, message_id: msg?.message_id }) };
        } catch (e) {
          return { statusCode:500, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ send_report: (() => {
  const enabled = (String(process.env.SEND_ENABLED) === '1');
  const base = {
    enabled,
    results: (typeof send_report !== 'undefined' && send_report && Array.isArray(send_report.results))
      ? send_report.results
      : []
  };
  if (enabled && !!message_vip  && !process.env.TG_VIP_CHAT_ID)  base.missing_vip_id = true;
  if (enabled && !!message_free && !process.env.TG_FREE_CHAT_ID) base.missing_free_id = true;
  return base;
})(),
ok:false, error: e?.message || String(e) }) };
        }
      }
      return { statusCode:200, headers:{'Content-Type':'text/html; charset=utf-8'}, body: html() };
    }
    if (event.httpMethod !== "POST") return ok({ ok:false, error:"Use POST" });

    const ctype = (event.headers && (event.headers["content-type"] || event.headers["Content-Type"])) || "";
    let text="", tipo="free";
    if (ctype.includes("application/json")) {
      const body = JSON.parse(event.body || "{}");
      text = String(body.text || ""); tipo = String(body.tipo || "free");
    } else if (ctype.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(event.body || "");
      text = String(params.get("text") || ""); tipo = String(params.get("tipo") || "free");
    } else {
      try {
        const body = JSON.parse(event.body || "{}");
        text = String(body.text || ""); tipo = String(body.tipo || "free");
      } catch { return ok({ ok:false, error:"Body no reconocido; usa JSON o form-urlencoded" }); }
    }
    if (!text) return ok({ ok:false, error:'Falta "text"' });

    const r = await sendTelegram(text, (tipo === "vip" ? "vip" : "free"));
    return ok(r);
  } catch (e) {
    return ok({ ok:false, error: e?.message || String(e) });
  }
};

// =======================================================
// ===============  PunterX · LIVE helpers  ===============
// =======================================================

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
  // HTML: mejor cuota en <b>negritas</b>
  return a.map((t, i) => {
    const line = `${t.bookie} — ${Number(t.price).toFixed(2)}`;
    return i === 0 ? `<b>${line}</b>` : line;
  }).join("\n");
}

// ===================
// Plantillas EN VIVO
// ===================
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
async function sendLiveFree(payload) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildLiveFreeMessage(payload);
  return tgSendText(TELEGRAM_CHANNEL_ID, text);
}

async function sendLiveVip(payload, { pin = true } = {}) {
  if (!TELEGRAM_BOT_TOKEN || !VIP_CHAT_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_VIP_GROUP_ID/TELEGRAM_GROUP_ID");
  const text = _buildLiveVipMessage(payload);
  const msg = await tgSendText(Number(VIP_CHAT_ID), text);
  if (pin) await tgPin(Number(VIP_CHAT_ID), msg.message_id, true);
  return msg;
}

// Editar mensaje (evitar spam). chat: "VIP" | "FREE"
async function editLiveMessage({ chat = "VIP", message_id, payload }) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  const chatId = chat === "FREE" ? TELEGRAM_CHANNEL_ID : Number(VIP_CHAT_ID);
  if (!chatId) throw new Error("ChatId inválido para edición");
  const text = (chat === "FREE") ? _buildLiveFreeMessage(payload) : _buildLiveVipMessage(payload);
  return tgEditText(chatId, message_id, text);
}

// PRE-MATCH
async function sendFreePrematch(p) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildPreFreeMessage(p);
  return tgSendText(TELEGRAM_CHANNEL_ID, text);
}
async function sendVipPrematch(p, { pin = false } = {}) {
  if (!TELEGRAM_BOT_TOKEN || !VIP_CHAT_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_VIP_GROUP_ID/TELEGRAM_GROUP_ID");
  const text = _buildPreVipMessage(p);
  const msg = await tgSendText(Number(VIP_CHAT_ID), text);
  if (pin) await tgPin(Number(VIP_CHAT_ID), msg.message_id, true);
  return msg;
}

// OUTRIGHTS
async function sendFreeOutright(p) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = _buildOutFreeMessage(p);
  return tgSendText(TELEGRAM_CHANNEL_ID, text);
}
async function sendVipOutright(p, { pin = false } = {}) {
  if (!TELEGRAM_BOT_TOKEN || !VIP_CHAT_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_VIP_GROUP_ID/TELEGRAM_GROUP_ID");
  const text = _buildOutVipMessage(p);
  const msg = await tgSendText(Number(VIP_CHAT_ID), text);
  if (pin) await tgPin(Number(VIP_CHAT_ID), msg.message_id, true);
  return msg;
}

// ===============================
// DM / Broadcast / Invitaciones
// ===============================
async function tgSendDM(tgId, text, extra = {}) {
  try {
    return await tgSendText(Number(tgId), text, extra);
  } catch (e) {
    console.error("tgSendDM error", e?.message || e);
    return { ok:false, error: e?.message || "exception" };
  }
}

async function tgBroadcastDM(tgIds = [], text, extra = {}) {
  const out = [];
  for (const id of Array.isArray(tgIds) ? tgIds : []) {
    /* eslint-disable no-await-in-loop */
    out.push(await tgSendDM(id, text, extra));
    await new Promise(r => setTimeout(r, 60)); // throttle suave
    /* eslint-enable no-await-in-loop */
  }
  return out;
}

async function tgCreateInviteLink(secondsValid = Number(process.env.TRIAL_INVITE_TTL_SECONDS) || 172800) {
  if (!VIP_CHAT_ID) throw new Error("VIP_CHAT_ID ausente");
  const expire = Math.floor(Date.now() / 1000) + secondsValid;
  const r = await tgCall("createChatInviteLink", {
    chat_id: VIP_CHAT_ID,
    expire_date: expire,
    member_limit: 1
    // creates_join_request: false
  });
  return r?.invite_link;
}

async function expulsarUsuarioVIP(userId) {
  if (!VIP_CHAT_ID) throw new Error("VIP_CHAT_ID ausente");
  try {
    await tgCall("banChatMember", { chat_id: VIP_CHAT_ID, user_id: userId });
  } catch (e) {
    console.error("banChatMember error", e?.message || e);
  }
  try {
    await tgCall("unbanChatMember", { chat_id: VIP_CHAT_ID, user_id: userId, only_if_banned: true });
  } catch (e) {
    // opcional
  }
}

// =====================================
// NUEVO: Mensajes listos para usuarios
// =====================================

// 1) Mensaje anclado FREE (copy pro)
function buildPinnedFreeMessage() {
  return [
    "📣 <b>PunterX — Radar Global 24/7</b>",
    "",
    "Nuestra IA Avanzada escanea <b>todas las ligas del mundo en tiempo real</b> para cazar <b>picks ocultos</b> con ventaja.",
    "",
    "🔎 Picks con <b>EV+</b> y momios actuales, respaldados por datos (xG, árbitro, clima, lesiones).",
    "",
    "<i>Acceso directo desde el bot. Sin pasos extra.</i>"
  ].join("\n");
}

// Envía (y opcionalmente fija) el mensaje anclado al canal FREE con botón al bot
async function sendPinnedFree({ pin = true } = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHANNEL_ID) throw new Error("Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID");
  const text = buildPinnedFreeMessage();
  const msg = await tgSendText(TELEGRAM_CHANNEL_ID, text, {
    reply_markup: {
      inline_keyboard: [[{ text: "🎯 Activar prueba VIP 15 días", url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=vip15` }]]
    }
  });
  if (pin) await tgPin(TELEGRAM_CHANNEL_ID, msg.message_id, true);
  return msg;
}

// 2) Mensaje de bienvenida por DM (explica EV y qué recibirá)
function buildWelcomeDM({ inviteLink }) {
  const evExpl = [
    "<b>¿Qué es EV?</b> Es la expectativa matemática de la apuesta.",
    "Si un pick tiene <b>EV +20%</b>, significa que por probabilidad y cuota hay una ventaja real frente al mercado."
  ].join("\n");

  return [
    "👋 <b>¡Bienvenido a PunterX!</b>",
    "",
    "Has activado tu periodo de <b>prueba VIP por 15 días</b>.",
    "Nuestro radar de IA recorre <b>ligas globales</b> para encontrar valor real:",
    "• Picks con <b>EV ≥ 15%</b> (🥉/🥈/🎯/🟣)",
    "• <b>Apuesta sugerida</b> + Top 3 bookies",
    "• <b>Apuestas extra</b> (over/BTTS/hándicap)",
    "• Contexto avanzado: xG, clima, árbitro, historial",
    "",
    evExpl,
    "",
    "👉 Accede al grupo VIP desde este enlace:",
    inviteLink || "<i>Enlace no disponible</i>",
    "",
    "<i>Contenido informativo. Apuesta con responsabilidad.</i>"
  ].join("\n");
}

async function sendWelcomeDM(chatId, inviteLink) {
  const text = buildWelcomeDM({ inviteLink });
  return tgSendText(Number(chatId), text);
}

// ==================
// Export principal
// ==================
module.exports = {
  // HTTP
  handler: exports.handler,

  // Envíos y edición
  sendLiveFree,
  sendLiveVip,
  editLiveMessage,
  sendFreePrematch,
  sendVipPrematch,
  sendFreeOutright,
  sendVipOutright,

  // Usuarios
  tgSendDM,
  tgBroadcastDM,
  tgCreateInviteLink,
  expulsarUsuarioVIP,

  // Mensajes para onboarding
  sendPinnedFree,
  sendWelcomeDM,

  // Wrapper compatible con tu código previo
  tgSendMessage: async (chatId, text, extra = {}) => tgSendText(chatId, text, extra)
};
