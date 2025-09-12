// netlify/functions/check-status.js
// Check de estado ligero para PunterX — seguro, rápido y sin 500.

// 1) Polyfill global.fetch si el runtime llega sin fetch (cold start / empaquetador)
try {
  if (typeof fetch === 'undefined') {
    // node-fetch v2 en CJS
    global.fetch = globalThis.fetch;
  }
} catch (_) { /* no romper por el polyfill */ }

// 2) Shim de Supabase (singleton, compatible ESM/CJS)
const getSupabase = require('./_lib/_supabase-client.cjs');

// 3) ENV y utilidades
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  TZ,
  NODE_VERSION
} = process.env;

const SITE_TZ = TZ || 'America/Toronto';
const T_NET = 5000;

const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;
const mask = (s, keep = 4) => {
  if (!s) return '';
  const str = String(s);
  if (str.length <= keep) return '*'.repeat(str.length);
  return str.slice(0, keep) + '*'.repeat(str.length - keep);
};

function asJSON(e) { return !!((e.queryStringParameters || {}).json); }
function isPing(e) { return !!((e.queryStringParameters || {}).ping); }

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally { clearTimeout(id); }
}

// 4) Check ligero de Supabase (lectura mínima)
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

// 5) Payload + render
function buildPayload(checks) {
  const env_presence = {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
  };
  const env_masked = {
    SUPABASE_URL: mask(SUPABASE_URL, 24),
    SUPABASE_KEY: mask(SUPABASE_KEY, 6),
  };
  const global = Object.values(checks).every(c => c?.status === 'UP') ? 'UP' : 'DEGRADED';
  return {
    generated_at: nowISO(),
    node: NODE_VERSION || process.version,
    tz: SITE_TZ,
    env_presence,
    env_masked,
    checks,
    global
  };
}

function renderHTML(payload) {
  const c = payload.global === 'UP' ? '#17c964' : '#f59f00';
  const htmlEscape = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const rowsEnv = Object.entries(payload.env_presence).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v ? '✅' : '❌'}</td><td class="muted">${htmlEscape(payload.env_masked[k] ?? '')}</td></tr>`
  ).join('');
  const rowsChecks = Object.entries(payload.checks).map(([k,obj]) => `
    <tr><th colspan="2">${k}</th></tr>
    <tr><td>status</td><td>${htmlEscape(obj.status)}</td></tr>
    <tr><td>ms</td><td>${htmlEscape(String(obj.ms || 0))}</td></tr>
    ${obj.error ? `<tr><td>error</td><td><code>${htmlEscape(obj.error)}</code></td></tr>` : ''}
  `).join('');
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Check Status</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}
  .wrap{max-width:820px;margin:0 auto;padding:16px}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px 0}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px;vertical-align:top}
</style>
<div class="wrap">
  <div class="card">
    <h1>Check Status <span style="color:${c}">${payload.global}</span></h1>
    <div class="muted">${htmlEscape(payload.generated_at)} · Node: ${htmlEscape(payload.node)} · TZ: ${htmlEscape(payload.tz)}</div>
    <div class="muted">Modos: <code>?json=1</code> · <code>?ping=1</code></div>
  </div>
  <div class="card"><h2>Env</h2><table>${rowsEnv}</table></div>
  <div class="card"><h2>Checks</h2><table>${rowsChecks}</table></div>
</div>`;
}

// 6) Handler (siempre 200, sin “Internal Error”)
exports.handler = async (event) => {
  try {
    if (isPing(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ send_report: (() => {
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
ok:true, ping:'pong', at: nowISO() }) };
    }

    const [sb] = await Promise.all([
      checkSupabase()
    ]);

    const payload = buildPayload({
      supabase: sb
    });

    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };
  } catch (e) {
    // Nunca 500: respuesta amigable
    const body = { ok:false, error: e?.message || String(e), at: nowISO() };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }
};
