// netlify/functions/send.js
// PunterX — Envío manual/operativo con HMAC opcional y reintentos seguros.

const fetch = require('node-fetch');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  SUPABASE_URL,
  SUPABASE_KEY,
  PUNTERX_SECRET, // opcional: si existe, exige HMAC
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function nowIso() { return new Date().toISOString(); }

function safeParse(body) {
  try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); }
  catch { return {}; }
}

// ===== HMAC opcional (si existe PUNTERX_SECRET) =====
function hmacOk(event, secret) {
  try {
    const headers = event.headers || {};
    const ts = headers['x-punterx-timestamp'] || headers['X-Punterx-Timestamp'];
    const sig = headers['x-punterx-signature'] || headers['X-Punterx-Signature'];
    if (!ts || !sig) return false;
    const skew = Math.abs(Date.now() - Number(ts));
    if (!Number.isFinite(skew) || skew > 5 * 60 * 1000) return false; // 5 min

    const raw = event.body || '';
    const mac = crypto.createHmac('sha256', secret).update(raw + ts).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(mac, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// ===== Utils HTTP =====
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchWithRetry(url, options = {}, { retries = 1, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok && retries > 0 && (res.status === 429 || (res.status >= 500 && res.status <= 599))) {
      // retry simple
      await sleep(800);
      return await fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
    }
    return res;
  } finally { clearTimeout(t); }
}

async function enviarTelegram(texto, tipo = 'free') {
  const chatId = tipo === 'vip' ? TELEGRAM_GROUP_ID : TELEGRAM_CHANNEL_ID;
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    console.warn('[send] Falta TOKEN/CHAT ID');
    return false;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const MAX = 4096;

  const partes = [];
  let tx = String(texto || '');
  while (tx.length > MAX) { partes.push(tx.slice(0, MAX)); tx = tx.slice(MAX); }
  partes.push(tx);

  for (const chunk of partes) {
    let res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' })
    }, { retries: 1, timeoutMs: 15000 });

    if (res && res.status === 429) {
      const j = await res.json().catch(()=>({}));
      const retryAfter = Number(j?.parameters?.retry_after || 0);
      if (retryAfter > 0 && retryAfter <= 10) {
        console.warn('[send] Telegram 429, esperando', retryAfter, 's');
        await sleep(retryAfter * 1000);
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' })
        });
      }
    }
    if (!res?.ok) {
      const t = await res.text().catch(()=> '');
      console.error('[send] Telegram no ok:', res?.status, t?.slice?.(0,300));
      return false;
    }
  }
  return true;
}

exports.handler = async (event) => {
  try {
    if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
      return json(500, { error: 'Config incompleta' });
    }

    // HMAC si hay secreto configurado
    if (PUNTERX_SECRET) {
      const ok = hmacOk(event, PUNTERX_SECRET);
      if (!ok) return json(401, { error: 'unauthorized' });
    } else {
      console.warn('[send] PUNTERX_SECRET no configurado — HMAC deshabilitado');
    }

    const body = safeParse(event.body);
    const { texto, tipo = 'free', guardar = false, liga, equipos, ev, probabilidad, nivel, apuesta } = body;

    if (!texto) return json(400, { error: 'texto requerido' });

    const ok = await enviarTelegram(texto, tipo);
    if (!ok) return json(502, { error: 'fallo telegram' });

    if (guardar) {
      try {
        const { error } = await supabase.from('picks_historicos').insert({
          evento: `${liga || ''} | ${equipos || ''}`,
          analisis: texto,
          apuesta: apuesta || '',
          tipo_pick: tipo,
          liga: liga || '',
          equipos: equipos || '',
          ev: Number.isFinite(ev) ? ev : null,
          probabilidad: Number.isFinite(probabilidad) ? probabilidad : null,
          nivel: nivel || null,
          timestamp: nowIso()
        });
        if (error) console.error('[send] supabase insert error:', error.message);
      } catch (e) { console.error('[send] supabase ex:', e?.message || e); }
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error('[send] error:', e?.message || e);
    return json(500, { error: 'internal' });
  }
};
