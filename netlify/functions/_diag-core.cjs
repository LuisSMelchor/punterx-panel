// netlify/functions/_diag-core.cjs
// Núcleo compartido del diagnóstico (checks + render) — UI pro + TZ Montreal

// Polyfill fetch por si el runtime frío no lo trae aún (harmless en Node 20)
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

// Montreal
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
  const ok = payload.global === 'UP';
  const statusColor = ok ? '#17c964' : '#f59f00';
  const bg = '#0b0d12', card = '#0f121a', border = '#1b2233', text = '#EAEFF7', muted = '#9AA8BF';
  const htmlEscape = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  const rowsEnv = Object.entries(payload.env_presence).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v ? '✅' : '❌'}</td><td class="muted">${htmlEscape(payload.env_masked[k] ?? '')}</td></tr>`
  ).join('');

  const rowsChecks = Object.entries(payload.checks).map(([k,obj]) => `
    <div class="check-card">
      <div class="check-title">${k}</div>
      <div class="check-row"><span>status</span><b style="color:${obj.status==='UP'?'#16a34a':'#f59f00'}">${htmlEscape(obj.status)}</b></div>
      <div class="check-row"><span>latencia</span><code>${htmlEscape(String(obj.ms || 0))} ms</code></div>
      ${obj.error ? `<div class="check-row"><span>error</span><code class="code">${htmlEscape(obj.error)}</code></div>` : ''}
      ${obj.details ? `<div class="check-row"><span>detalles</span><pre class="code">${htmlEscape(JSON.stringify(obj.details, null, 2))}</pre></div>` : ''}
    </div>
  `).join('');

  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg:${bg}; --card:${card}; --border:${border};
    --text:${text}; --muted:${muted}; --accent:${statusColor};
  }
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font:14px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto,Inter,Arial,sans-serif;margin:0}
  .wrap{max-width:1120px;margin:0 auto;padding:24px}
  .header{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:16px}
  .badge{display:inline-flex;align-items:center;gap:8px;background:color-mix(in srgb,var(--accent),#000 80%);color:#fff;border:1px solid var(--accent);padding:6px 10px;border-radius:999px;font-weight:600}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px}
  .grid{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}
  .muted{color:var(--muted)}
  table{width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:top}
  th{font-weight:600}
  code.code, pre.code{background:#0a0d13;border:1px solid #192233;border-radius:8px;padding:8px;color:#c7e1ff;display:inline-block;max-width:100%;overflow:auto}
  .checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .check-card{background:#0c1118;border:1px solid #1a2537;border-radius:12px;padding:12px}
  .check-title{font-weight:700;margin-bottom:8px}
  .check-row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}
  .footer{margin-top:16px;color:var(--muted);font-size:12px}
  .chips{display:flex;gap:8px;flex-wrap:wrap}
  .chip{border:1px solid var(--border);background:#0b0f15;color:var(--muted);padding:4px 8px;border-radius:8px}
  a{color:#8ab4ff;text-decoration:none}
</style>
<div class="wrap">
  <div class="header">
    <h1 style="margin:0;font-size:20px">PunterX — Diagnóstico <span class="badge">${ok ? 'UP' : 'DEGRADED'}</span></h1>
    <div class="chips">
      <div class="chip">TZ: ${htmlEscape(payload.tz)}</div>
      <div class="chip">Node: ${htmlEscape(payload.node)}</div>
      <div class="chip">Generado: ${htmlEscape(payload.generated_at)}</div>
      <div class="chip"><a href="?json=1">JSON</a> · <a href="?ping=1">PING</a></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2 style="margin-top:0">Checks</h2>
      <div class="checks">${rowsChecks}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Entorno</h2>
      <table>
        <tbody>${rowsEnv}</tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <div>© ${new Date().getFullYear()} PunterX · Estado global: <b style="color:var(--accent)">${ok ? 'UP' : 'DEGRADED'}</b></div>
  </div>
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
