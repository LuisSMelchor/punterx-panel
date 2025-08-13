// netlify/functions/diagnostico-total.js
// Diagnóstico integral — robusto y sin crashes (HTML por defecto / ?json=1 / ?deep=1 / ?ping=1)
//
// Cambios clave:
// - Polyfill global.fetch si no existe (entornos edge / empaquetador).
// - fetchWithTimeout con AbortController y manejo seguro.
// - Trampas globales uncaughtException/unhandledRejection (solo log).
// - Chequeos modulares (Supabase / OpenAI / OddsAPI / API‑Football / Telegram).
// - Modo rápido (?ping=1), JSON (?json=1) y “deep” (?deep=1) sin romper aunque falten ENV.

if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

// Trampas globales (no rompen respuesta)
process.on('uncaughtException', (e) => {
  try { console.error('[DIAG][uncaughtException]', e && (e.stack || e.message || e)); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { console.error('[DIAG][unhandledRejection]', e && (e.stack || e.message || e)); } catch {}
});

const getSupabase = require('./_supabase-client.cjs');

// ENV
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  AUTH_CODE,
  PUNTERX_SECRET,
  TZ,
  NODE_VERSION
} = process.env;

const SITE_TZ = TZ || 'America/Mexico_City';
const AUTH_KEYS = [AUTH_CODE, PUNTERX_SECRET].filter(Boolean);
const T_NET = 7000;

// Utils
const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;
function asJSON(event)   { return !!((event.queryStringParameters || {}).json); }
function asDeep(event)   { return !!((event.queryStringParameters || {}).deep); }
function asPing(event)   { return !!((event.queryStringParameters || {}).ping); }
function isAuthed(event) {
  const qs = event.queryStringParameters || {};
  const code = qs.code || qs.token || '';
  if (!AUTH_KEYS.length) return false;
  return AUTH_KEYS.some(k => k && k === code);
}
function mask(str, keep = 4) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= keep) return '*'.repeat(s.length);
  return s.slice(0, keep) + '*'.repeat(s.length - keep);
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally {
    clearTimeout(id);
  }
}
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return null; } }

// ---- Chequeos ----
async function checkSupabase() {
  const t0 = Date.now();
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return { status: 'DOWN', ms: ms(t0), error: 'SUPABASE_URL/SUPABASE_KEY ausentes' };
    }
    const supabase = await getSupabase();
    const { error } = await supabase.from('picks_historicos').select('id').limit(1);
    if (error) return { status: 'DOWN', ms: ms(t0), error: error.message };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

function buildOpenAIPayload(model, prompt, maxOut = 120) {
  const m = String(model || '').toLowerCase();
  const modern = /gpt-5|gpt-4\.1|4o|o3|mini/.test(m);
  const base = {
    model,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  };
  if (modern) base.max_completion_tokens = maxOut; else base.max_tokens = maxOut;
  if (!/gpt-5|o3/.test(m)) base.temperature = 0.2;
  return base;
}

async function checkOpenAI() {
  const t0 = Date.now();
  try {
    if (!OPENAI_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'OPENAI_API_KEY ausente' };
    const OpenAI = require('openai');
    const oai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const model = OPENAI_MODEL || 'gpt-5-mini';
    const completion = await oai.chat.completions.create(
      buildOpenAIPayload(model, 'Devuelve {"ok":true} como JSON.', 20)
    );
    const content = completion?.choices?.[0]?.message?.content || '';
    const ok = /"ok"\s*:\s*true/i.test(content);
    return { status: ok ? 'UP' : 'WARN', ms: ms(t0), model, bytes: content.length };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkOddsAPI() {
  const t0 = Date.now();
  try {
    if (!ODDS_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'ODDS_API_KEY ausente' };
    // endpoint ligero
    const url = `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithTimeout(url, { timeout: 6000 });
    if (!res || !res.ok) return { status: 'DOWN', ms: ms(t0), error: `status ${res?.status}` };
    const js = await safeJson(res);
    const n = Array.isArray(js) ? js.length : 0;
    return { status: 'UP', ms: ms(t0), sports: n };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkAPIFootball() {
  const t0 = Date.now();
  try {
    if (!API_FOOTBALL_KEY) return { status: 'DOWN', ms: ms(t0), error: 'API_FOOTBALL_KEY ausente' };
    const url = 'https://v3.football.api-sports.io/status';
    const res = await fetchWithTimeout(url, { headers: { 'x-apisports-key': API_FOOTBALL_KEY }, timeout: 6000 });
    if (!res || !res.ok) return { status: 'DOWN', ms: ms(t0), error: `status ${res?.status}` };
    const js = await safeJson(res);
    const st = js?.response?.[0]?.status || js?.response?.status || 'ok?';
    return { status: 'UP', ms: ms(t0), api: String(st) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkTelegram() {
  const t0 = Date.now();
  try {
    if (!TELEGRAM_BOT_TOKEN) return { status: 'DOWN', ms: ms(t0), error: 'TELEGRAM_BOT_TOKEN ausente' };
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    const res = await fetchWithTimeout(url, { timeout: 6000 });
    const js = await safeJson(res);
    const ok = !!(js && js.ok);
    const name = js?.result?.username || '';
    return { status: ok ? 'UP' : 'DOWN', ms: ms(t0), bot: name };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

// Payload + HTML
function buildPayload(sb, deep = {}, event) {
  return {
    generated_at: nowISO(),
    node: NODE_VERSION || process.version,
    timezone: SITE_TZ,
    request: {
      json: asJSON(event),
      deep: asDeep(event),
      ping: asPing(event),
      authed: isAuthed(event)
    },
    env_presence: {
      SUPABASE_URL: !!SUPABASE_URL,
      SUPABASE_KEY: !!SUPABASE_KEY,
      OPENAI_API_KEY: !!OPENAI_API_KEY,
      ODDS_API_KEY: !!ODDS_API_KEY,
      API_FOOTBALL_KEY: !!API_FOOTBALL_KEY,
      TELEGRAM_BOT_TOKEN: !!TELEGRAM_BOT_TOKEN,
      TELEGRAM_CHANNEL_ID: !!TELEGRAM_CHANNEL_ID,
      TELEGRAM_GROUP_ID: !!TELEGRAM_GROUP_ID,
    },
    env_masked: {
      SUPABASE_URL: mask(SUPABASE_URL, 20),
      SUPABASE_KEY: mask(SUPABASE_KEY, 6),
      TELEGRAM_CHANNEL_ID: mask(TELEGRAM_CHANNEL_ID, 2),
      TELEGRAM_GROUP_ID: mask(TELEGRAM_GROUP_ID, 2),
    },
    checks: {
      supabase: sb,
      ...deep
    },
    global: {
      status: (sb.status === 'UP') ? 'UP' : 'DEGRADED'
    }
  };
}

function renderHTML(payload) {
  const c = payload.global.status === 'UP' ? '#17c964' : '#f59f00';
  const deep = payload.checks;
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico Total</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px}
  code{background:#0e1320;border:1px solid #212638;border-radius:6px;padding:2px 6px}
  a{color:#60a5fa;text-decoration:none}
</style>
<div class="card">
  <h1>Diagnóstico Total <span style="color:${c}">${payload.global.status}</span></h1>
  <div class="muted">${payload.generated_at} · Node: ${payload.node} · TZ: ${payload.timezone}</div>
  <div class="muted">Modos: <code>?json=1</code> · <code>?deep=1</code> · <code>?ping=1</code></div>
</div>
<div class="card">
  <h2>Variables de Entorno</h2>
  <table>
    ${Object.entries(payload.env_presence).map(([k,v]) => `
      <tr><td>${k}</td><td>${v ? '✅' : '❌'}</td><td class="muted">${payload.env_masked[k] ?? ''}</td></tr>
    `).join('')}
  </table>
</div>
<div class="card">
  <h2>Cheques</h2>
  <table>
    <tr><th>Servicio</th><th>Status</th><th>ms</th><th>Extra</th></tr>
    <tr><td>Supabase</td><td>${deep.supabase?.status}</td><td>${deep.supabase?.ms}</td><td>${deep.supabase?.error ?? ''}</td></tr>
    <tr><td>OpenAI</td><td>${deep.openai?.status ?? '-'}</td><td>${deep.openai?.ms ?? '-'}</td><td>${deep.openai?.model ?? deep.openai?.error ?? ''}</td></tr>
    <tr><td>OddsAPI</td><td>${deep.oddsapi?.status ?? '-'}</td><td>${deep.oddsapi?.ms ?? '-'}</td><td>${(deep.oddsapi?.sports!=null)?('sports='+deep.oddsapi.sports): (deep.oddsapi?.error ?? '')}</td></tr>
    <tr><td>API‑Football</td><td>${deep.apifoot?.status ?? '-'}</td><td>${deep.apifoot?.ms ?? '-'}</td><td>${deep.apifoot?.api ?? deep.apifoot?.error ?? ''}</td></tr>
    <tr><td>Telegram</td><td>${deep.telegram?.status ?? '-'}</td><td>${deep.telegram?.ms ?? '-'}</td><td>${deep.telegram?.bot ?? deep.telegram?.error ?? ''}</td></tr>
  </table>
</div>`;
}

// Handler
exports.handler = async (event) => {
  try {
    const sb = await checkSupabase();

    // Modo PING (súper rápido)
    if (asPing(event)) {
      const body = { ok: true, ping: 'pong', at: nowISO(), node: NODE_VERSION || process.version };
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }

    // Chequeos “deep” solo si lo piden y, si configuraste AUTH_CODE/PUNTERX_SECRET, solo si autentican
    let deep = {};
    const wantDeep = asDeep(event);
    const authed = isAuthed(event);
    if (wantDeep && (authed || !AUTH_KEYS.length)) {
      const [openai, oddsapi, apifoot, telegram] = await Promise.all([
        checkOpenAI().catch(e => ({ status:'DOWN', error: e?.message || String(e) })),
        checkOddsAPI().catch(e => ({ status:'DOWN', error: e?.message || String(e) })),
        checkAPIFootball().catch(e => ({ status:'DOWN', error: e?.message || String(e) })),
        checkTelegram().catch(e => ({ status:'DOWN', error: e?.message || String(e) })),
      ]);
      deep = { supabase: sb, openai, oddsapi, apifoot, telegram };
    } else {
      deep = { supabase: sb };
    }

    const payload = buildPayload(sb, deep, event);

    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };

  } catch (e) {
    // Nunca devolver 500 al usuario; entregamos JSON “amable”
    const msg = e?.message || String(e);
    console.error('[DIAG] fatal:', msg);
    const body = { ok:false, error: msg, at: nowISO() };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
};
