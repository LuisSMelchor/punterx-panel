// netlify/functions/_diag-core.cjs
// Núcleo compartido del diagnóstico (checks + render)

// Polyfill fetch por si el runtime frío no lo trae aún
try {
  if (typeof fetch === 'undefined') {
    global.fetch = require('node-fetch');
  }
} catch (_) {}

const getSupabase = require('./_supabase-client.cjs');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_GROUP_ID,
  TZ,
  NODE_VERSION
} = process.env;

const SITE_TZ = TZ || 'America/Toronto';
const T_NET = 8000;

const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;
const mask = (s, keep = 4) => {
  if (!s) return '';
  const str = String(s);
  if (str.length <= keep) return '*'.repeat(str.length);
  return str.slice(0, keep) + '*'.repeat(str.length - keep);
};

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    return await fetch(resource, { ...opts, signal });
  } finally { clearTimeout(id); }
}

// ----- CHECKS -----
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

async function checkOpenAI() {
  const t0 = Date.now();
  try {
    if (!OPENAI_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'OPENAI_API_KEY ausente' };
    const res = await fetchWithTimeout('https://api.openai.com/v1/models?limit=1', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      timeout: 6000
    });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status}` };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkOddsAPI() {
  const t0 = Date.now();
  try {
    if (!ODDS_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'ODDS_API_KEY ausente' };
    const url = `https://api.the-odds-api.com/v4/sports?apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithTimeout(url, { timeout: 6000 });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status}` };
    const js = await res.json().catch(()=>null);
    return { status: 'UP', ms: ms(t0), details: { sports: Array.isArray(js) ? js.length : 'n/a' } };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkAPIFootball() {
  const t0 = Date.now();
  try {
    if (!API_FOOTBALL_KEY) return { status: 'DOWN', ms: ms(t0), error: 'API_FOOTBALL_KEY ausente' };
    const res = await fetchWithTimeout('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
      timeout: 6000
    });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status}` };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function checkTelegram() {
  const t0 = Date.now();
  try {
    if (!TELEGRAM_BOT_TOKEN) return { status: 'DOWN', ms: ms(t0), error: 'TELEGRAM_BOT_TOKEN ausente' };
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, { timeout: 6000 });
    const js = await res.json().catch(()=>null);
    const ok = !!(js && js.ok);
    return { status: ok ? 'UP' : 'DOWN', ms: ms(t0), details: { bot: js?.result?.username || '' } };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

// ----- BUILD PAYLOAD + HTML -----
function buildPayload(checks) {
  const env_presence = {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    OPENAI_API_KEY: !!OPENAI_API_KEY,
    ODDS_API_KEY: !!ODDS_API_KEY,
    API_FOOTBALL_KEY: !!API_FOOTBALL_KEY,
    TELEGRAM_BOT_TOKEN: !!TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID: !!TELEGRAM_CHANNEL_ID,
    TELEGRAM_GROUP_ID: !!TELEGRAM_GROUP_ID
  };
  const env_masked = {
    SUPABASE_URL: mask(SUPABASE_URL, 24),
    SUPABASE_KEY: mask(SUPABASE_KEY, 6),
    TELEGRAM_CHANNEL_ID: mask(TELEGRAM_CHANNEL_ID, 2),
    TELEGRAM_GROUP_ID: mask(TELEGRAM_GROUP_ID, 2),
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
    ${obj.details ? `<tr><td>details</td><td><pre>${htmlEscape(JSON.stringify(obj.details, null, 2))}</pre></td></tr>` : ''}
  `).join('');
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico Total</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}
  .wrap{max-width:980px;margin:0 auto;padding:16px}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px 0}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px;vertical-align:top}
</style>
<div class="wrap">
  <div class="card">
    <h1>Diagnóstico <span style="color:${c}">${payload.global}</span></h1>
    <div class="muted">${htmlEscape(payload.generated_at)} · Node: ${htmlEscape(payload.node)} · TZ: ${htmlEscape(payload.tz)}</div>
    <div class="muted">Modos: <code>?json=1</code> · <code>?ping=1</code></div>
  </div>
  <div class="card"><h2>Env</h2><table>${rowsEnv}</table></div>
  <div class="card"><h2>Checks</h2><table>${rowsChecks}</table></div>
</div>`;
}

// Punto único para ejecutar todos los checks
async function runChecks() {
  const [sb, oai, odds, foot, tg] = await Promise.all([
    checkSupabase(),
    checkOpenAI(),
    checkOddsAPI(),
    checkAPIFootball(),
    checkTelegram()
  ]);
  return buildPayload({
    supabase: sb, openai: oai, oddsapi: odds, apifootball: foot, telegram: tg
  });
}

module.exports = {
  runChecks,
  renderHTML
};
