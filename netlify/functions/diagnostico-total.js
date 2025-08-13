// netlify/functions/diagnostico-total.js
// Dashboard/health integral para PunterX — robusto ante entornos sin fetch y sin ESM en init.

// 1) Shim de fetch (Node <20 / bundlers que no exponen global.fetch)
if (typeof fetch === 'undefined') {
  try { global.fetch = require('node-fetch'); } catch (_) { /* no-op */ }
}

// 2) Trampas globales para evitar “Internal Error” silencioso
try {
  process.on('uncaughtException', (e) => {
    try { console.error('[DIAG][uncaughtException]', e && (e.stack || e.message || e)); } catch {}
  });
  process.on('unhandledRejection', (e) => {
    try { console.error('[DIAG][unhandledRejection]', e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) {}

// 3) Envs (no fallar si faltan; sólo reportar)
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
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

// 4) Utiles
const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;
function asJSON(event) { return !!((event.queryStringParameters || {}).json); }
function isPing(event) { return !!((event.queryStringParameters || {}).ping); }
function deepRequested(event) { return !!((event.queryStringParameters || {}).deep); }
function isAuthed(event) {
  const qs = event.queryStringParameters || {};
  const code = qs.code || qs.token || '';
  if (!AUTH_KEYS.length) return false;
  return AUTH_KEYS.some(k => k && k === code);
}
function mask(s, keep = 4) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= keep) return '*'.repeat(str.length);
  return str.slice(0, keep) + '*'.repeat(str.length - keep);
}

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

async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return null; } }

// 5) Supabase via shim seguro (CJS + ESM dinámico dentro)
const getSupabase = require('./_supabase-client.cjs');
async function pingSupabase() {
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

// 6) Checks externos (solo si piden deep=1 y están autenticados)
async function checkOpenAI() {
  try {
    if (!OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY ausente' };
    // ping liviano (sin consumir tokens): HEAD a api.openai.com
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      timeout: 5000
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
async function checkOddsAPI() {
  try {
    if (!ODDS_API_KEY) return { ok: false, error: 'ODDS_API_KEY ausente' };
    const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?markets=h2h&regions=eu&oddsFormat=decimal&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithTimeout(url, { timeout: 6000 });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
async function checkAPIFootball() {
  try {
    if (!API_FOOTBALL_KEY) return { ok: false, error: 'API_FOOTBALL_KEY ausente' };
    const res = await fetchWithTimeout('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
      timeout: 6000
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
async function checkTelegram() {
  try {
    if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' };
    // Método que no envía mensajes: getMe
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    const res = await fetchWithTimeout(url, { timeout: 5000 });
    const js = await safeJson(res);
    return { ok: res.ok && js?.ok === true, status: res.status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 7) Render
function renderHTML(payload) {
  const c = payload.global.status === 'UP' ? '#17c964' : '#f31260';
  const deep = payload.deep || {};
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico Total</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px}
  code{background:#0f1220;padding:2px 6px;border-radius:6px}
</style>
<div class="card">
  <h1>Diagnóstico Total <span style="color:${c}">${payload.global.status}</span></h1>
  <div class="muted">${payload.generated_at} · Node: ${payload.node} · TZ: ${payload.timezone}</div>
</div>
<div class="card">
  <h2>Entorno</h2>
  <table>
    ${Object.entries(payload.env_presence).map(([k,v]) => `
      <tr><td>${k}</td><td>${v ? '✅' : '❌'}</td><td class="muted">${payload.env_masked[k] ?? ''}</td></tr>
    `).join('')}
  </table>
</div>
<div class="card">
  <h2>Checks</h2>
  <table>
    <tr><td>supabase</td><td>${payload.checks.supabase.status}</td><td>${payload.checks.supabase.ms} ms</td></tr>
    ${payload.checks.supabase.error ? `<tr><td>supabase.error</td><td colspan="2">${payload.checks.supabase.error}</td></tr>` : ''}
    ${deep.openai ? `<tr><td>openai</td><td colspan="2">${deep.openai.ok ? 'OK' : 'FAIL'} (status ${deep.openai.status || 'n/a'})</td></tr>` : ''}
    ${deep.oddsapi ? `<tr><td>oddsapi</td><td colspan="2">${deep.oddsapi.ok ? 'OK' : 'FAIL'} (status ${deep.oddsapi.status || 'n/a'})</td></tr>` : ''}
    ${deep.apifootball ? `<tr><td>api-football</td><td colspan="2">${deep.apifootball.ok ? 'OK' : 'FAIL'} (status ${deep.apifootball.status || 'n/a'})</td></tr>` : ''}
    ${deep.telegram ? `<tr><td>telegram</td><td colspan="2">${deep.telegram.ok ? 'OK' : 'FAIL'} (status ${deep.telegram.status || 'n/a'})</td></tr>` : ''}
  </table>
  <p class="muted">Tip: añade <code>?json=1</code> para JSON y <code>?deep=1&code=***</code> para pruebas con proveedores.</p>
</div>`;
}

function buildPayload(sb, event, deepChecks = {}) {
  return {
    generated_at: nowISO(),
    node: NODE_VERSION || process.version,
    timezone: SITE_TZ,
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
    checks: { supabase: sb },
    deep: deepChecks,
    global: { status: (sb.status === 'UP') ? 'UP' : 'DOWN' }
  };
}

// 8) Handler
exports.handler = async (event) => {
  const t0 = Date.now();

  try {
    if (isPing(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'pong' };
    }

    const sb = await pingSupabase();
    let deep = {};
    if (deepRequested(event) && isAuthed(event)) {
      // Ejecutar en paralelo pero tolerante a fallos:
      const [oai, odds, foot, tg] = await Promise.allSettled([
        checkOpenAI(), checkOddsAPI(), checkAPIFootball(), checkTelegram()
      ]);
      const get = (p) => (p.status === 'fulfilled' ? p.value : { ok: false, error: p.reason?.message || String(p.reason) });
      deep = { openai: get(oai), oddsapi: get(odds), apifootball: get(foot), telegram: get(tg) };
    }

    const payload = buildPayload(sb, event, deep);

    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ...payload, ms: ms(t0) }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };

  } catch (e) {
    const msg = e?.message || String(e);
    // 👉 Nunca 500: devolvemos 200 con error en JSON/HTML para evitar “Internal Error”
    const safe = { ok: false, error: msg, at: 'handler', ms: ms(t0) };
    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(safe) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: `Error: ${msg}` };
  }
};
