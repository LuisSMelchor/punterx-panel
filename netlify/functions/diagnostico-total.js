// netlify/functions/diagnostico-total.js
// Diagnóstico integral PunterX — HTML + JSON + persistencia de estado
// CommonJS (Netlify Functions). Sin claves expuestas. Con auth opcional por querystring.
//
//   - HTML:  /.netlify/functions/diagnostico-total
//   - JSON:  /.netlify/functions/diagnostico-total?json=1
//   - Deep:  /.netlify/functions/diagnostico-total?deep=1
//   - Auth:  /.netlify/functions/diagnostico-total?code=XXXXX   (AUTH_CODE o PUNTERX_SECRET)

// ========================== POLYFILLS / BASE ==========================
// Polyfill robusto de fetch para CJS/Node 18/20 bajo esbuild/Netlify
const fetch = global.fetch || require('node-fetch');

// ========================== ENV / CONFIG ==========================
const {
  SUPABASE_URL,
  SUPABASE_KEY, // usa Service Role si quieres escritura; con anon solo lectura según RLS
  OPENAI_API_KEY,
  OPENAI_MODEL,
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

// timeouts de red (ms)
const T_NET = 7000;

// ========================== FETCH CON TIMEOUT ==========================
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(resource, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ========================== UTILS ==========================
const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;

function mask(str, keep = 4) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= keep) return '*'.repeat(s.length);
  return s.slice(0, keep) + '*'.repeat(s.length - keep);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

function okToDeep(authenticated, deepRequested) {
  // Si hay autenticación correcta, permitimos deep cuando se pide (?deep=1)
  // Sin auth: solo modo superficial (para evitar costos/ratelimits).
  return authenticated && deepRequested;
}

function isAuthed(event) {
  const code = (event.queryStringParameters && (event.queryStringParameters.code || event.queryStringParameters.token)) || '';
  if (!AUTH_KEYS.length) return false;
  return AUTH_KEYS.some(k => k && k === code);
}

function asJSON(event) {
  return !!(event.queryStringParameters && event.queryStringParameters.json);
}

function deepRequested(event) {
  return !!(event.queryStringParameters && event.queryStringParameters.deep);
}

function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleString('es-MX', { timeZone: SITE_TZ, hour12: false });
  } catch {
    return d || '';
  }
}

// ========================== SUPABASE (ESM dinámico, robusto) ==========================
// Usamos un espacio global para evitar colisiones si el bundler evalúa el archivo más de una vez.
var __PX_DIAG__ = globalThis.__PX_DIAG__ || (globalThis.__PX_DIAG__ = {});
if (typeof __PX_DIAG__.__supaCreate === 'undefined') {
  __PX_DIAG__.__supaCreate = null;
}

// 🔒 FIX: clave de caché idempotente para evitar "Identifier 'SUPA_CACHE_KEY' has already been declared"
if (typeof __PX_DIAG__.SUPA_CACHE_KEY === 'undefined') {
  __PX_DIAG__.SUPA_CACHE_KEY = 'px_supa_client';
}
const SUPA_CACHE_KEY = __PX_DIAG__.SUPA_CACHE_KEY;

/**
 * Carga dinámica de @supabase/supabase-js (ESM-only) desde CJS.
 * Nunca lanza: si falla, devuelve null y el diagnóstico mostrará "Supabase: DOWN".
 */
async function getCreateClient() {
  if (__PX_DIAG__.__supaCreate) return __PX_DIAG__.__supaCreate;
  try {
    const mod = await import('@supabase/supabase-js');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (typeof createClient !== 'function') throw new Error('createClient no encontrado en @supabase/supabase-js');
    __PX_DIAG__.__supaCreate = createClient; // cache global
    return __PX_DIAG__.__supaCreate;
  } catch (e) {
    console.error('[DIAG] Error importando @supabase/supabase-js:', e && (e.message || e));
    return null; // ← muy importante: no rompemos la función
  }
}

/**
 * Devuelve un cliente de Supabase o null si no es posible construirlo.
 */
async function supa() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const createClient = await getCreateClient();
  if (!createClient) return null;
  try {
    // Nota: no usamos SUPA_CACHE_KEY aún para mapear múltiples clientes, pero
    // mantener la constante única evita redeclaraciones en el bundle.
    return createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('[DIAG] Error creando cliente Supabase:', e && (e.message || e));
    return null;
  }
}

async function sbTestBasic(authenticated) {
  // Prueba de conectividad + consulta de picks recientes
  const client = await supa();
  const t0 = Date.now();
  if (!client) return { status: 'DOWN', ms: ms(t0), error: 'SUPABASE_URL/SUPABASE_KEY ausentes' };

  try {
    const { data, error } = await client
      .from('picks_historicos')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (error) return { status: 'DOWN', ms: ms(t0), error: error.message };
    return { status: 'UP', ms: ms(t0), sample: (data && data[0]) ? data[0].timestamp : null };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) };
  }
}

async function sbCounts() {
  const client = await supa();
  if (!client) return { today: 0, last7d: 0, last30d: 0 };

  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0,0,0,0);

  const isoToday = startToday.toISOString();
  const iso7d = new Date(now - 7*86400000).toISOString();
  const iso30d = new Date(now - 30*86400000).toISOString();

  async function getCount(ts) {
    const { count, error } = await client
      .from('picks_historicos')
      .select('*', { count: 'exact', head: true })
      .gte('timestamp', ts);
    return error ? 0 : (count || 0);
  }

  try {
    const [cT, c7, c30] = await Promise.all([getCount(isoToday), getCount(iso7d), getCount(iso30d)]);
    return { today: cT, last7d: c7, last30d: c30 };
  } catch {
    return { today: 0, last7d: 0, last30d: 0 };
  }
}

async function sbFetchExecs(limit = 20) {
  const client = await supa();
  if (!client) return [];
  const { data, error } = await client
    .from('diagnostico_ejecuciones')
    .select('function_name, started_at, ended_at, duration_ms, ok, error_message')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

async function sbUpsertEstado(payload) {
  const client = await supa();
  if (!client) return { ok: false, error: 'No Supabase client' };
  try {
    const { error } = await client
      .from('diagnostico_estado')
      .upsert({
        fn_name: 'diagnostico-total',
        status: payload?.global?.status || 'UNKNOWN',
        details: payload,
        updated_at: new Date().toISOString()
      })
      .select('fn_name')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function sbInsertEjecucion(row) {
  const client = await supa();
  if (!client) return;
  try {
    await client
      .from('diagnostico_ejecuciones')
      .insert([row]);
  } catch (e) {
    // silencioso
  }
}

// ========================== CHECKS EXTERNOS ==========================
async function checkOpenAI({ deep, authenticated }) {
  const t0 = Date.now();
  if (!OPENAI_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'OPENAI_API_KEY ausente' };
  if (!okToDeep(authenticated, deep)) {
    return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  }
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      timeout: T_NET
    });
    if (!res.ok) {
      const txt = await safeText(res);
      return { status: 'DOWN', ms: ms(t0), http: res.status, body: (txt || '').slice(0, 160) };
    }
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) };
  }
}

async function checkOddsAPI({ deep, authenticated }) {
  const t0 = Date.now();
  if (!ODDS_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'ODDS_API_KEY ausente' };
  if (!okToDeep(authenticated, deep)) {
    return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  }
  try {
    const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`;
    const res = await fetchWithTimeout(url, { timeout: T_NET });
    if (!res.ok) {
      const txt = await safeText(res);
      return { status: 'DOWN', ms: ms(t0), http: res.status, body: (txt || '').slice(0, 160) };
    }
    return { status: 'UP', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) };
  }
}

async function checkAPIFootball({ deep, authenticated }) {
  const t0 = Date.now();
  if (!API_FOOTBALL_KEY) return { status: 'DOWN', ms: ms(t0), error: 'API_FOOTBALL_KEY ausente' };
  if (!okToDeep(authenticated, deep)) {
    return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  }
  try {
    const res = await fetchWithTimeout('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
      timeout: T_NET
    });
    if (!res.ok) {
      const txt = await safeText(res);
      return { status: 'DOWN', ms: ms(t0), http: res.status, body: (txt || '').slice(0, 160) };
    }
    const data = await safeJson(res);
    const apiStatus = data?.response?.subscription?.active ? 'UP' : 'WARN';
    return { status: apiStatus, ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) };
  }
}

async function checkTelegram({ deep, authenticated }) {
  const t0 = Date.now();
  if (!TELEGRAM_BOT_TOKEN) return { status: 'DOWN', ms: ms(t0), error: 'TELEGRAM_BOT_TOKEN ausente' };
  if (!okToDeep(authenticated, deep)) {
    return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    const res = await fetchWithTimeout(url, { timeout: T_NET });
    if (!res.ok) {
      const txt = await safeText(res);
      return { status: 'DOWN', ms: ms(t0), http: res.status, body: (txt || '').slice(0, 160) };
    }
    const data = await safeJson(res);
    const ok = data?.ok === true;
    return { status: ok ? 'UP' : 'DOWN', ms: ms(t0) };
  } catch (e) {
    return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) };
  }
}

// ========================== PAYLOAD ==========================
function globalStatus(parts) {
  // Prioridad: DOWN > WARN > UP
  const order = { DOWN: 3, WARN: 2, UP: 1, UNKNOWN: 0 };
  let worst = 'UP';
  for (const p of parts) {
    const s = (p && p.status) || 'UNKNOWN';
    if (order[s] > order[worst]) worst = s;
  }
  return worst;
}

function buildPayload({ envInfo, sbBasic, counts, execs, checks, authenticated }) {
  return {
    generated_at: nowISO(),
    timezone: SITE_TZ,
    node: NODE_VERSION || process.version,
    authenticated,
    env: envInfo,
    supabase_basic: sbBasic,
    counts,
    execs,
    checks,
    global: { status: globalStatus([sbBasic, checks.openai, checks.oddsapi, checks.apifootball, checks.telegram]) }
  };
}

function pickEnvInfo(authenticated) {
  return {
    TZ: SITE_TZ,
    OPENAI_MODEL: OPENAI_MODEL || '(default)',
    SUPABASE_URL: authenticated ? SUPABASE_URL : mask(SUPABASE_URL, 20),
    SUPABASE_KEY: authenticated ? mask(SUPABASE_KEY, 6) : '********',
    ODDS_API_KEY: authenticated ? mask(ODDS_API_KEY, 6) : '********',
    API_FOOTBALL_KEY: authenticated ? mask(API_FOOTBALL_KEY, 6) : '********',
    TELEGRAM_BOT_TOKEN: authenticated ? mask(TELEGRAM_BOT_TOKEN, 6) : '********',
    TELEGRAM_CHANNEL_ID: TELEGRAM_CHANNEL_ID ? mask(TELEGRAM_CHANNEL_ID, 2) : '',
    TELEGRAM_GROUP_ID: TELEGRAM_GROUP_ID ? mask(TELEGRAM_GROUP_ID, 2) : ''
  };
}

// ========================== HTML UI ==========================
function colorByStatus(st) {
  switch (st) {
    case 'UP': return '#17c964';
    case 'WARN': return '#f5a524';
    case 'DOWN': return '#f31260';
    default: return '#a1a1aa';
  }
}

function iconByStatus(st) {
  switch (st) {
    case 'UP': return '✅';
    case 'WARN': return '⚠️';
    case 'DOWN': return '❌';
    default: return '•';
  }
}

function tile(label, status, details) {
  const c = colorByStatus(status);
  return `
  <div class="tile">
    <div class="tile-top">
      <span class="dot" style="background:${c}"></span>
      <span class="label">${htmlEscape(label)}</span>
      <span class="status" style="color:${c}">${iconByStatus(status)} ${status}</span>
    </div>
    <pre class="mono">${htmlEscape(details || '')}</pre>
  </div>`;
}

function renderHTML(payload) {
  const { env, supabase_basic, counts, execs, checks, global } = payload;

  const envBlock = `
  <table class="env">
    <tr><td>TZ</td><td>${htmlEscape(env.TZ)}</td></tr>
    <tr><td>OPENAI_MODEL</td><td>${htmlEscape(env.OPENAI_MODEL)}</td></tr>
    <tr><td>SUPABASE_URL</td><td>${htmlEscape(env.SUPABASE_URL)}</td></tr>
    <tr><td>SUPABASE_KEY</td><td>${htmlEscape(env.SUPABASE_KEY)}</td></tr>
    <tr><td>ODDS_API_KEY</td><td>${htmlEscape(env.ODDS_API_KEY)}</td></tr>
    <tr><td>API_FOOTBALL_KEY</td><td>${htmlEscape(env.API_FOOTBALL_KEY)}</td></tr>
    <tr><td>TELEGRAM_BOT_TOKEN</td><td>${htmlEscape(env.TELEGRAM_BOT_TOKEN)}</td></tr>
    <tr><td>TELEGRAM_CHANNEL_ID</td><td>${htmlEscape(env.TELEGRAM_CHANNEL_ID)}</td></tr>
    <tr><td>TELEGRAM_GROUP_ID</td><td>${htmlEscape(env.TELEGRAM_GROUP_ID)}</td></tr>
  </table>`;

  const sbDetails = [
    `status: ${supabase_basic.status}`,
    supabase_basic.error ? `error: ${supabase_basic.error}` : null,
    supabase_basic.sample ? `último pick ts: ${fmtDate(supabase_basic.sample)}` : null,
    `latencia: ${supabase_basic.ms} ms`
  ].filter(Boolean).join('\n');

  const openaiDetails = [
    `status: ${checks.openai.status}`,
    checks.openai.error ? `error: ${checks.openai.error}` : null,
    checks.openai.http ? `http: ${checks.openai.http}` : null,
    `latencia: ${checks.openai.ms} ms`,
    checks.openai.note ? `nota: ${checks.openai.note}` : null
  ].filter(Boolean).join('\n');

  const oddsDetails = [
    `status: ${checks.oddsapi.status}`,
    checks.oddsapi.error ? `error: ${checks.oddsapi.error}` : null,
    checks.oddsapi.http ? `http: ${checks.oddsapi.http}` : null,
    `latencia: ${checks.oddsapi.ms} ms`,
    checks.oddsapi.note ? `nota: ${checks.oddsapi.note}` : null
  ].filter(Boolean).join('\n');

  const footDetails = [
    `status: ${checks.apifootball.status}`,
    checks.apifootball.error ? `error: ${checks.apifootball.error}` : null,
    checks.apifootball.http ? `http: ${checks.apifootball.http}` : null,
    `latencia: ${checks.apifootball.ms} ms`,
    checks.apifootball.note ? `nota: ${checks.apifootball.note}` : null
  ].filter(Boolean).join('\n');

  const tgDetails = [
    `status: ${checks.telegram.status}`,
    checks.telegram.error ? `error: ${checks.telegram.error}` : null,
    checks.telegram.http ? `http: ${checks.telegram.http}` : null,
    `latencia: ${checks.telegram.ms} ms`,
    checks.telegram.note ? `nota: ${checks.telegram.note}` : null
  ].filter(Boolean).join('\n');

  const execRows = (execs || []).map(e => `
    <tr>
      <td>${htmlEscape(e.function_name)}</td>
      <td>${fmtDate(e.started_at)}</td>
      <td>${fmtDate(e.ended_at)}</td>
      <td class="num">${e.duration_ms ?? ''}</td>
      <td>${e.ok ? '✅' : '❌'}</td>
      <td>${htmlEscape(e.error_message || '')}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="muted">Sin registros</td></tr>';

  const c = colorByStatus(global.status);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PunterX — Diagnóstico Total</title>
  <style>
    :root{
      --bg:#0b0b10; --card:#11131a; --muted:#9ca3af; --fg:#e5e7eb; --green:#17c964; --amber:#f5a524; --red:#f31260; --blue:#3b82f6;
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif;}
    header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #1f2330;background:#0d0f16;position:sticky;top:0;z-index:10}
    .brand{display:flex;gap:10px;align-items:center}
    .brand .dot{width:10px;height:10px;border-radius:50%;}
    .title{font-weight:700;letter-spacing:0.2px}
    .subtitle{color:var(--muted);font-size:12px}
    .grid{display:grid;gap:16px;padding:20px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
    .tile{background:var(--card);border-radius:14px;padding:14px;border:1px solid #1f2330;box-shadow:0 0 0 1px rgba(255,255,255,0.02) inset}
    .tile-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    .dot{width:10px;height:10px;border-radius:50%;}
    .label{font-weight:600}
    .status{margin-left:auto;font-weight:700}
    .mono{white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace;font-size:12px;color:#d1d5db;background:#0d0f16;padding:10px;border-radius:10px;border:1px solid #1f2330}
    table.env{width:100%;border-collapse:collapse}
    table.env td{padding:6px 8px;border-bottom:1px dashed #1f2330;font-size:13px}
    .section{padding:0 20px 20px}
    .cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
    .card{background:var(--card);border:1px solid #1f2330;border-radius:14px;padding:14px}
    .muted{color:var(--muted)}
    h2{margin:12px 0;font-size:16px}
    table.tbl{width:100%;border-collapse:collapse}
    table.tbl th, table.tbl td{padding:8px;border-bottom:1px solid #1f2330;font-size:13px;text-align:left}
    table.tbl th{color:#cbd5e1;font-weight:700}
    .num{text-align:right}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#0d0f16;border:1px solid #1f2330}
    .kbd{font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;background:#0d0f16;border:1px solid #1f2330;border-radius:6px;padding:2px 6px;font-size:12px}
    footer{padding:16px 20px;color:#94a3b8;font-size:12px;display:flex;justify-content:space-between;border-top:1px solid #1f2330}
    a{color:#93c5fd;text-decoration:none}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="dot" style="background:${c}"></span>
      <div>
        <div class="title">PunterX — Diagnóstico Total</div>
        <div class="subtitle">Estado global: <span class="pill" style="border-color:${c};color:${c}">${global.status}</span></div>
      </div>
    </div>
    <div class="subtitle">
      ${htmlEscape(payload.generated_at)} · Zona: ${htmlEscape(payload.timezone)} · Node: ${htmlEscape(payload.node)}
    </div>
  </header>

  <div class="grid">
    ${tile('Supabase', supabase_basic.status, sbDetails)}
    ${tile('OpenAI', checks.openai.status, openaiDetails)}
    ${tile('OddsAPI', checks.oddsapi.status, oddsDetails)}
    ${tile('API‑Football', checks.apifootball.status, footDetails)}
    ${tile('Telegram', checks.telegram.status, tgDetails)}
  </div>

  <section class="section">
    <h2>Entorno</h2>
    <div class="card">
      ${envBlock}
      <div class="muted" style="margin-top:8px">*Valores sensibles en modo público aparecen enmascarados. Añade <span class="kbd">?code=…</span> para vista autenticada.</div>
    </div>
  </section>

  <section class="section cards">
    <div class="card">
      <h2>Actividad de picks</h2>
      <table class="tbl">
        <tr><th>Hoy</th><th>Últimos 7 días</th><th>Últimos 30 días</th></tr>
        <tr>
          <td class="num">${counts.today}</td>
          <td class="num">${counts.last7d}</td>
          <td class="num">${counts.last30d}</td>
        </tr>
      </table>
      <div class="muted" style="margin-top:8px">Fuente: <span class="kbd">picks_historicos</span></div>
    </div>

    <div class="card">
      <h2>Últimas ejecuciones</h2>
      <table class="tbl">
        <tr><th>Función</th><th>Inicio</th><th>Fin</th><th>ms</th><th>OK</th><th>Error</th></tr>
        ${execRows}
      </table>
      <div class="muted" style="margin-top:8px">Fuente: <span class="kbd">diagnostico_ejecuciones</span></div>
    </div>
  </section>

  <footer>
    <div>
      Vista: ${payload.authenticated ? 'Autenticada' : 'Pública'} ·
      <a href="?json=1${payload.authenticated ? '&code=HIDDEN' : ''}">JSON</a> ·
      <a href="?deep=1${payload.authenticated ? '&code=HIDDEN' : ''}">Deep</a>
    </div>
    <div>© ${new Date().getFullYear()} PunterX</div>
  </footer>
</body>
</html>`;
}

// ========================== HANDLER ==========================
exports.handler = async (event) => {
  try {
    const startedAt = new Date();
    const authenticated = isAuthed(event);
    const wantJSON = asJSON(event);
    const wantDeep = deepRequested(event);

    // 1) Chequeos base Supabase (conectividad y conteos)
    const [sbBasic, counts, execs] = await Promise.all([
      sbTestBasic(authenticated),
      sbCounts(),
      sbFetchExecs(20),
    ]);

    // 2) Chequeos externos (OpenAI, OddsAPI, API‑Football, Telegram)
    const checks = {
      openai: await checkOpenAI({ deep: wantDeep, authenticated }),
      oddsapi: await checkOddsAPI({ deep: wantDeep, authenticated }),
      apifootball: await checkAPIFootball({ deep: wantDeep, authenticated }),
      telegram: await checkTelegram({ deep: wantDeep, authenticated }),
    };

    // 3) Payload consolidado
    const envInfo = pickEnvInfo(authenticated);
    const payload = buildPayload({
      envInfo,
      sbBasic,
      counts,
      execs,
      checks,
      authenticated,
    });

    // 4) Persistencia de estado + ejecución
    const endedAt = new Date();
    try {
      await sbUpsertEstado(payload);
    } catch (_) {}
    try {
      await sbInsertEjecucion({
        function_name: 'diagnostico-total',
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: endedAt - startedAt,
        ok: payload.global.status !== 'DOWN',
        error_message: null
      });
    } catch (_) {}

    // 5) Respuesta (HTML o JSON)
    if (wantJSON) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload, null, 2)
      };
    }

    const html = renderHTML(payload);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html
    };
  } catch (e) {
    // Contención: jamás respondas 500 a Netlify; entrega HTML con el error
    const msg = (e && (e.message || String(e))) || 'Error desconocido';
    const html = `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico Total (Error atrapado)</title>
<pre style="font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
Diagnóstico atrapó una excepción y evitó el 500.
Mensaje: ${htmlEscape(msg)}
</pre>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }
};
