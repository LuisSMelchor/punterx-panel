// netlify/functions/tg_trial_webhook.cjs
// v3.4 — Consolidado, bienvenida mejorada, enlace directo al VIP, sin borrar tu lógica

'use strict';

// (Polyfill) — Netlify en Node 20 ya trae fetch, pero si corrieras esto localmente en otra versión:
try { if (typeof fetch === 'undefined') global.fetch = require('node-fetch'); } catch (_) {}

const VERSION = 'tg_trial_webhook v3.4 (welcome+consolidated)';
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 15);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Acepta cualquiera de las dos envs para el grupo VIP
const VIP_CHAT_ID = process.env.TELEGRAM_VIP_GROUP_ID || process.env.TELEGRAM_GROUP_ID;

// ---------- Utils ----------
function addDays(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; }
function daysBetween(now, futureISO) {
  const diff = new Date(futureISO).getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
function safeStr(v, def = '') { return (typeof v === 'string' ? v : def); }

// ---------- Supabase (ESM dynamic import) ----------
async function getSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[Supabase init] Faltan SUPABASE_URL/KEY');
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('[Supabase init] import/createClient falló', e);
    return null;
  }
}

// ---------- Telegram helpers ----------
async function tgSendMessageLocal(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(()=> ({}));
  if (!json.ok) console.error('[tgSendMessageLocal] fail', json);
  return !!json.ok;
}

async function tgCreateInviteLinkLocal() {
  if (!VIP_CHAT_ID) {
    console.error('[Invite] VIP_CHAT_ID ausente');
    return null;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`;
  const ttl = Number(process.env.TRIAL_INVITE_TTL_SECONDS || 0);
  const expire_date = ttl > 0 ? Math.floor(Date.now() / 1000) + ttl : undefined;

  const body = {
    chat_id: VIP_CHAT_ID,
    member_limit: 1,                // 1 uso
    creates_join_request: false,    // acceso directo (si quieres aprobación manual, cambia a true y maneja approveJoinRequest)
    ...(expire_date ? { expire_date } : {})
  };

  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(()=> ({}));
  if (!json.ok) { console.error('[tgCreateInviteLinkLocal] fail', json); return null; }
  return json.result?.invite_link ?? null;
}

// ---------- Mensajes (copy mejorado) ----------
function buildWelcomeMessage(inviteLink) {
  return [
    '👋 <b>¡Bienvenido a PunterX!</b>',
    '',
    `Has activado tu periodo de <b>prueba VIP por ${TRIAL_DAYS} días</b>.`,
    '',
    'Nuestro <b>radar de IA Avanzada</b> escanea <b>todas las ligas del mundo en tiempo real</b> para detectar valor oculto:',
    '',
    '• <b>EV ≥ 15%</b> → Ventaja matemática real frente al mercado',
    '   🥉 15–19% Competitivo',
    '   🥈 20–29% Avanzado',
    '   🎯 30–39% Élite Mundial',
    '   🟣 40%+ Ultra Élite',
    '',
    '• <b>Apuesta sugerida</b> + Top 3 bookies',
    '• <b>Apuestas extra</b> (Over/BTTS/Hándicap, etc.)',
    '• <b>Contexto avanzado</b>: xG, árbitro, clima, historial',
    '',
    '<b>¿Qué es EV?</b>',
    'La <i>expectativa matemática</i> de una apuesta. Si un pick tiene <b>EV +20%</b>, la combinación de probabilidad y momio está a tu favor.',
    '',
    '👉 Acceso directo al grupo VIP:',
    `<a href="${inviteLink}">🔓 Entrar al VIP</a>`,
    '',
    '<i>Recibirás recordatorios cuando falten 3 días y el último día. Apuesta con responsabilidad.</i>'
  ].join('\n');
}

function buildHelpMessage() {
  return [
    'ℹ️ <b>Ayuda PunterX</b>',
    '• /vip — Activa tu prueba VIP de 15 días',
    '• /status — Verifica tu estado (trial/premium/expirado)',
    '',
    'En el VIP recibes picks con EV≥15%, apuesta sugerida, top‑3 bookies y datos avanzados.'
  ].join('\n');
}

function buildStatusMessage(u) {
  if (!u) return 'No encuentro registro. Escribe /vip para activar tu prueba.';
  if (u.estado === 'premium') return '🟢 Estatus: <b>Premium</b>. ¡Gracias por tu suscripción!';
  if (u.estado === 'trial' && u.fecha_expira && new Date(u.fecha_expira) > new Date()) {
    const dias = daysBetween(new Date(), u.fecha_expira);
    return `🟡 Estatus: <b>Trial</b>. Te quedan <b>${dias} día(s)</b> de prueba.`;
  }
  return '🔴 Estatus: <b>Expirado</b>. Para continuar, contrata el plan Premium.';
}

// ---------- Handler ----------
exports.handler = async (event) => {
  try {
    console.log(`[${VERSION}] method=${event && event.httpMethod}`);
    if (!event || event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // Debug mínimo (silencioso si ya está en prod; deja los console si te ayudan)
    console.log('[env] SUPABASE_URL?', !!process.env.SUPABASE_URL);
    console.log('[env] TELEGRAM_BOT_TOKEN?', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('[env] VIP_CHAT_ID?', !!VIP_CHAT_ID);

    // Parse seguro
    let update = {};
    try {
      update = JSON.parse(event.body || '{}');
      const preview = safeStr(event.body, '').slice(0, 160).replace(/\s+/g, ' ');
      console.log(`[${VERSION}] body[0..160]= ${preview}`);
    } catch {
      return { statusCode: 200, body: 'bad json' };
    }

    // Solo mensajes privados con texto
    const msg = update && update.message;
    if (!msg || typeof msg !== 'object') return { statusCode: 200, body: 'ignored' };
    const chat = msg.chat;
    if (!chat || chat.type !== 'private') return { statusCode: 200, body: 'ignored' };
    if (typeof msg.text !== 'string' || msg.text.trim() === '') return { statusCode: 200, body: 'ignored' };

    const chatId = chat.id;
    const text = msg.text.trim();
    const username = (msg.from && typeof msg.from.username === 'string') ? msg.from.username : '';

    // --------- Comandos básicos ----------
    if (text === '/ayuda') {
      await tgSendMessageLocal(chatId, buildHelpMessage());
      return { statusCode: 200, body: 'ok' };
    }

    if (text === '/status') {
      const supabase = await getSupabase();
      if (!supabase || typeof supabase.from !== 'function') {
        await tgSendMessageLocal(chatId, '⚠️ No puedo consultar tu estado ahora. Intenta de nuevo en unos minutos.');
        return { statusCode: 200, body: 'no-supabase' };
      }

      const { data: u, error } = await supabase
        .from('usuarios')
        .select('estado, fecha_expira')
        .eq('id_telegram', chatId)
        .maybeSingle();

      if (error) {
        await tgSendMessageLocal(chatId, '⚠️ Error temporal al consultar tu estado. Intenta de nuevo.');
        return { statusCode: 200, body: 'error' };
      }

      await tgSendMessageLocal(chatId, buildStatusMessage(u));
      return { statusCode: 200, body: 'ok' };
    }

    // --------- Activación (start/vip) ----------
    const isStart = text.startsWith('/start');  // Acepta "/start" y "/start vip15"
    const isVip   = text.startsWith('/vip');

    if (!isStart && !isVip) {
      await tgSendMessageLocal(chatId, '👋 Bienvenido a PunterX.\nEscribe <b>/vip</b> para activar tu prueba gratis de 15 días en el grupo VIP.');
      return { statusCode: 200, body: 'ok' };
    }

    // Init Supabase
    const supabase = await getSupabase();
    if (!supabase || typeof supabase.from !== 'function') {
      console.error('[Supabase] Cliente no inicializado (init falló).');
      await tgSendMessageLocal(chatId, '⚠️ Configuración pendiente del servidor. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'no-supabase' };
    }

    // 1) Consulta estado actual
    const { data: existing, error: qErr } = await supabase
      .from('usuarios')
      .select('id_telegram, estado, fecha_expira')
      .eq('id_telegram', chatId)
      .maybeSingle();

    if (qErr) {
      console.error('[Supabase select error]', qErr);
      await tgSendMessageLocal(chatId, '⚠️ Error temporal. Intenta de nuevo en unos minutos.');
      return { statusCode: 200, body: 'error' };
    }

    // Si ya es premium → no reescribir ni crear link de prueba
    if (existing && existing.estado === 'premium') {
      await tgSendMessageLocal(chatId, '✅ Ya eres <b>Premium</b>. Revisa el grupo VIP en tu Telegram.');
      return { statusCode: 200, body: 'ok' };
    }

    // Si está en trial activo → reenvía un link nuevo (para no bloquear su acceso)
    if (existing && existing.estado === 'trial' && existing.fecha_expira && new Date(existing.fecha_expira) > new Date()) {
      const inviteLinkActive = await tgCreateInviteLinkLocal();
      if (inviteLinkActive) {
        await tgSendMessageLocal(chatId, buildWelcomeMessage(inviteLinkActive));
      } else {
        await tgSendMessageLocal(chatId, 'ℹ️ Tu prueba sigue activa, pero no pude generar un enlace ahora. Intenta en unos minutos.');
      }
      return { statusCode: 200, body: 'ok' };
    }

    // Si expiró → informar
    if (existing && existing.estado === 'expired') {
      await tgSendMessageLocal(chatId, '⛔ Tu periodo de prueba ya expiró.\nPara continuar, contrata el plan Premium.');
      return { statusCode: 200, body: 'ok' };
    }

    // 2) Activar trial (o crear si no existía)
    const fecha_inicio = new Date();
    const fecha_expira = addDays(fecha_inicio, TRIAL_DAYS);

    const upsert = await supabase
      .from('usuarios')
      .upsert(
        {
          id_telegram: chatId,
          username,
          estado: 'trial',
          fecha_inicio: fecha_inicio.toISOString(),
          fecha_expira: fecha_expira.toISOString(),
        },
        { onConflict: 'id_telegram' }
      )
      .select()
      .maybeSingle();

    if (upsert.error) {
      console.error('[Supabase upsert error]', upsert.error);
      await tgSendMessageLocal(chatId, '⚠️ Error al activar tu prueba. Intenta de nuevo.');
      return { statusCode: 200, body: 'error' };
    }

    // 3) Enlace de 1 uso al VIP
    const inviteLink = await tgCreateInviteLinkLocal();
    if (!inviteLink) {
      await tgSendMessageLocal(chatId, '⚠️ No pude generar el enlace de invitación. Intenta más tarde.');
      return { statusCode: 200, body: 'error' };
    }

    // 4) Bienvenida con explicación (EV, niveles, etc.)
    await tgSendMessageLocal(chatId, buildWelcomeMessage(inviteLink));
    console.log(`[${VERSION}] trial granted and link sent`);
    return { statusCode: 200, body: 'ok' };

  } catch (e) {
    console.error(`[${VERSION}] webhook error`, e);
    return { statusCode: 200, body: 'error' };
  }
};
