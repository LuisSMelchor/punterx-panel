// netlify/functions/check-status.js
// Healthcheck rápido del entorno y conectividad básica.
// GET /.netlify/functions/check-status?json=1
//
// Reporta: presencia de envs críticos + ping mínimo a Supabase + echo de versión Node.

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

const SITE_TZ = TZ || 'America/Mexico_City';
const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;

function asJSON(event) { return !!((event.queryStringParameters || {}).json); }
function mask(s, keep = 4) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= keep) return '*'.repeat(str.length);
  return str.slice(0, keep) + '*'.repeat(str.length - keep);
}

async function pingSupabase() {
  const t0 = Date.now();
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return { status: 'DOWN', ms: ms(t0), error: 'SUPABASE_URL/SUPABASE_KEY ausentes' };
    }
    const supabase = await getSupabase(); // ← singleton
    const { error } = await supabase.from('picks_historicos').select('id').limit(1);
    if (error) return { status: 'DOWN', ms: ms(t0), error: error.message };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

function buildPayload(sb) {
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
    checks: {
      supabase: sb
    },
    global: {
      status: (sb.status === 'UP') ? 'UP' : 'DOWN'
    }
  };
}

function renderHTML(payload) {
  const c = payload.global.status === 'UP' ? '#17c964' : '#f31260';
  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Check Status</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px}
</style>
<div class="card">
  <h1>Check Status <span style="color:${c}">${payload.global.status}</span></h1>
  <div class="muted">${payload.generated_at} · Node: ${payload.node} · TZ: ${payload.timezone}</div>
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
  <h2>Supabase</h2>
  <table>
    <tr><td>status</td><td>${payload.checks.supabase.status}</td></tr>
    <tr><td>ms</td><td>${payload.checks.supabase.ms}</td></tr>
    ${payload.checks.supabase.error ? `<tr><td>error</td><td>${payload.checks.supabase.error}</td></tr>` : ''}
  </table>
</div>`;
}

exports.handler = async (event) => {
  try {
    const sb = await pingSupabase();
    const payload = buildPayload(sb);
    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };
  } catch (e) {
    const msg = e?.message || String(e);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: msg }) };
  }
};
