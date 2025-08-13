// netlify/functions/diagnostico-total.js
// Diagnóstico integral — robusto, sin crashear y con polyfill de fetch

// 1) Asegurar fetch en cualquier runtime
try {
  if (typeof fetch === 'undefined') {
    // node-fetch v2 para compatibilidad CJS
    global.fetch = require('node-fetch');
  }
} catch (_) {
  // no romper por el polyfill
}

// 2) Trampas globales para NO romper la respuesta
process.on('uncaughtException', (e) => {
  try { console.error('[DIAG][uncaughtException]', e && (e.stack || e.message || e)); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { console.error('[DIAG][unhandledRejection]', e && (e.stack || e.message || e)); } catch {}
});

console.log('[DIAG] module-load');

const getSupabase = require('./_supabase-client.cjs');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-5-mini',
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
const NET_TIMEOUT = 8000;

function nowISO() { return new Date().toISOString(); }
function ms(t0) { return Date.now() - t0; }
function asJSON(event) { return !!((event.queryStringParameters || {}).json); }
function isPing(event) { return !!((event.queryStringParameters || {}).ping); }
function deepRequested(event) { return !!((event.queryStringParameters || {}).deep); }
function isAuthed(event) {
  const qs = event.queryStringParameters || {};
  const code = qs.code || qs.token || '';
  if (!AUTH_KEYS.length) return false;
  return AUTH_KEYS.some(k => k && k === code);
}
function mask(val, keep = 4) {
  const s = String(val || '');
  if (!s) return '';
  if (s.length <= keep) return '*'.repeat(s.length);
  return s.slice(0, keep) + '*'.repeat(s.length - keep);
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = NET_TIMEOUT, ...init } = options || {};
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const id = setTimeout(() => { try { ctrl && ctrl.abort(); } catch {} }, timeout);
  try {
    const signal = ctrl ? ctrl.signal : undefined;
    const res = await fetch(resource, { ...init, signal });
    return res;
  } finally { clearTimeout(id); }
}

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

async function pingOpenAI() {
  const t0 = Date.now();
  try {
    if (!OPENAI_API_KEY) return { status: 'SKIP', ms: ms(t0), error: 'OPENAI_API_KEY ausente' };
    // Ping de bajo costo: listar 1 modelo
    const res = await fetchWithTimeout('https://api.openai.com/v1/models?limit=1', {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    if (!res.ok) {
      const body = await res.text().catch(()=> '');
      return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status} ${body.slice(0,120)}` };
    }
    return { status: 'UP', ms: ms(t0), model: OPENAI_MODEL };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function pingOddsAPI() {
  const t0 = Date.now();
  try {
    if (!ODDS_API_KEY) return { status: 'SKIP', ms: ms(t0), error: 'ODDS_API_KEY ausente' };
    const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&markets=h2h&oddsFormat=decimal&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status}` };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function pingAPIFootball() {
  const t0 = Date.now();
  try {
    if (!API_FOOTBALL_KEY) return { status: 'SKIP', ms: ms(t0), error: 'API_FOOTBALL_KEY ausente' };
    const res = await fetchWithTimeout('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status}` };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

async function pingTelegram() {
  const t0 = Date.now();
  try {
    if (!TELEGRAM_BOT_TOKEN) return { status: 'SKIP', ms: ms(t0), error: 'TELEGRAM_BOT_TOKEN ausente' };
    // getMe no envía mensajes y sirve como health
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    if (!res.ok) {
      const body = await res.text().catch(()=> '');
      return { status: 'DOWN', ms: ms(t0), error: `HTTP ${res.status} ${body.slice(0,120)}` };
    }
    return { status: 'UP', ms: ms(t0), channels: { ch: !!TELEGRAM_CHANNEL_ID, grp: !!TELEGRAM_GROUP_ID } };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e?.message || String(e) };
  }
}

function buildPayload({ sb, oai, odds, foot, tg }, includeSecrets = false) {
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
    env_masked: includeSecrets ? {
      SUPABASE_URL: mask(SUPABASE_URL, 20),
      SUPABASE_KEY: mask(SUPABASE_KEY, 6),
      TELEGRAM_CHANNEL_ID: mask(TELEGRAM_CHANNEL_ID, 2),
      TELEGRAM_GROUP_ID: mask(TELEGRAM_GROUP_ID, 2),
    } : undefined,
    checks: {
      supabase: sb,
      // Los pings “deep” solo se llenan si se pidió deep y hubo auth
      openai: oai || { status: 'SKIP' },
      oddsapi: odds || { status: 'SKIP' },
      apifootball: foot || { status: 'SKIP' },
      telegram: tg || { status: 'SKIP' }
    },
    global: {
      status: (sb && sb.status === 'UP') ? 'UP' : 'DEGRADED'
    }
  };
}

function renderHTML(payload) {
  const c = payload.global.status === 'UP' ? '#17c964' : '#f5a524';
  const envRows = Object.entries(payload.env_presence || {}).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v ? '✅' : '❌'}</td><td class="muted">${payload.env_masked && payload.env_masked[k] ? payload.env_masked[k] : ''}</td></tr>`
  ).join('');

  function checkTable(name, obj) {
    if (!obj) return '';
    const rows = Object.entries(obj).map(([k,v]) => `<tr><td>${k}</td><td>${String(v)}</td></tr>`).join('');
    return `<div class="card"><h2>${name}</h2><table>${rows}</table></div>`;
  }

  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto;margin:0}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  .muted{color:#94a3b8}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px;vertical-align:top}
  h1,h2{margin:0 0 8px}
</style>
<div class="card">
  <h1>Diagnóstico <span style="color:${c}">${payload.global.status}</span></h1>
  <div class="muted">${payload.generated_at} · Node: ${payload.node} · TZ: ${payload.timezone}</div>
</div>
<div class="card">
  <h2>Variables de Entorno</h2>
  <table>${envRows}</table>
</div>
${checkTable('Supabase', payload.checks.supabase)}
${checkTable('OpenAI', payload.checks.openai)}
${checkTable('OddsAPI', payload.checks.oddsapi)}
${checkTable('API‑Football', payload.checks.apifootball)}
${checkTable('Telegram', payload.checks.telegram)}
`;
}

exports.handler = async (event) => {
  const started = Date.now();
  try {
    // Modo ping: respuesta fast
    if (isPing(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'pong' };
    }

    // Ping mínimo SIEMPRE: Supabase
    const sb = await pingSupabase();

    // Pings “profundos” SOLO si lo piden y están autenticados
    let oai, odds, foot, tg;
    const wantDeep = deepRequested(event);
    const authed = isAuthed(event);

    if (wantDeep && authed) {
      [oai, odds, foot, tg] = await Promise.all([
        pingOpenAI(),
        pingOddsAPI(),
        pingAPIFootball(),
        pingTelegram()
      ]);
    }

    const payload = buildPayload({ sb, oai, odds, foot, tg }, /*includeSecrets*/ authed);

    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };
  } catch (e) {
    // JAMÁS devolvemos 500 para que Netlify no muestre “Internal Error”
    const msg = e?.message || String(e);
    const fail = {
      generated_at: nowISO(),
      error: msg,
      elapsed_ms: ms(Date.now())
    };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fail) };
  } finally {
    console.log('[DIAG] done in', ms(Date.now()), 'ms');
  }
};
