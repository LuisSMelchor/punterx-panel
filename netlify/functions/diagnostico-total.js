// netlify/functions/diagnostico-total.js
// Diagnóstico integral — versión con trampas globales y ping de vida

// ---- Trampas globales para capturar cualquier crash temprano ----
process.on('uncaughtException', (e) => {
  try { console.error('[DIAG][uncaughtException]', e && (e.stack || e.message || e)); } catch {}
});
process.on('unhandledRejection', (e) => {
  try { console.error('[DIAG][unhandledRejection]', e && (e.stack || e.message || e)); } catch {}
});

console.log('[DIAG] module-load');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
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
const T_NET = 7000;

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = T_NET, ...opts } = options;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try { return await fetch(resource, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}

const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;

function mask(str, keep = 4) {
  if (!str) return '';
  const s = String(str);
  if (s.length <= keep) return '*'.repeat(s.length);
  return s.slice(0, keep) + '*'.repeat(s.length - keep);
}
async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return null; } }
function okToDeep(authenticated, deepRequested) { return authenticated && deepRequested; }
function isAuthed(event) {
  const qs = event.queryStringParameters || {};
  const code = qs.code || qs.token || '';
  if (!AUTH_KEYS.length) return false;
  return AUTH_KEYS.some(k => k && k === code);
}
function asJSON(event) { return !!((event.queryStringParameters || {}).json); }
function deepRequested(event) { return !!((event.queryStringParameters || {}).deep); }
function isPing(event) { return !!((event.queryStringParameters || {}).ping); }
function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(d) {
  try { return new Date(d).toLocaleString('es-MX', { timeZone: SITE_TZ, hour12: false }); }
  catch { return d || ''; }
}

// ---------------- Supabase (import dinámico + singleton global) ----------------
let __supaPromise = null;
async function getSupabase() {
  if (__supaPromise) return __supaPromise;
  if (!globalThis.__PX_SUPA__) globalThis.__PX_SUPA__ = {};
  if (globalThis.__PX_SUPA__.client) {
    __supaPromise = Promise.resolve(globalThis.__PX_SUPA__.client);
    return __supaPromise;
  }
  const url = SUPABASE_URL, key = SUPABASE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY');

  try {
    const mod = await import('@supabase/supabase-js');
    const createClient = mod.createClient || (mod.default && mod.default.createClient);
    if (typeof createClient !== 'function') throw new Error('createClient no encontrado en @supabase/supabase-js');
    const client = createClient(url, key);
    globalThis.__PX_SUPA__.client = client;
    __supaPromise = Promise.resolve(client);
    return client;
  } catch (e) {
    console.error('[DIAG] getSupabase fail:', e?.stack || e?.message || e);
    __supaPromise = null;
    throw e;
  }
}

async function sbClient() {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    return await getSupabase();
  } catch { return null; } // degradar sin romper
}

async function sbTestBasic() {
  const t0 = Date.now();
  const client = await sbClient();
  if (!client) return { status: 'DOWN', ms: ms(t0), error: 'SUPABASE_URL/SUPABASE_KEY ausentes o cliente no disponible' };
  try {
    const { data, error } = await client
      .from('picks_historicos').select('timestamp').order('timestamp', { ascending: false }).limit(1);
    if (error) return { status: 'DOWN', ms: ms(t0), error: error.message };
    return { status: 'UP', ms: ms(t0), sample: (data && data[0]) ? data[0].timestamp : null };
  } catch (e) { return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) }; }
}

async function sbCounts() {
  const client = await sbClient();
  if (!client) return { today: 0, last7d: 0, last30d: 0 };
  const now = new Date();
  const isoToday = new Date(now.setHours(0,0,0,0)).toISOString();
  const iso7d = new Date(Date.now() - 7*86400000).toISOString();
  const iso30d = new Date(Date.now() - 30*86400000).toISOString();
  async function getCount(ts) {
    const { count, error } = await client.from('picks_historicos').select('*', { count: 'exact', head: true }).gte('timestamp', ts);
    return error ? 0 : (count || 0);
  }
  try {
    const [cT, c7, c30] = await Promise.all([getCount(isoToday), getCount(iso7d), getCount(iso30d)]);
    return { today: cT, last7d: c7, last30d: c30 };
  } catch { return { today: 0, last7d: 0, last30d: 0 }; }
}

async function sbFetchExecs(limit = 20) {
  const client = await sbClient();
  if (!client) return [];
  const { data, error } = await client
    .from('diagnostico_ejecuciones')
    .select('function_name, started_at, ended_at, duration_ms, ok, error_message')
    .order('id', { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}

async function sbUpsertEstado(payload) {
  const client = await sbClient();
  if (!client) return { ok: false, error: 'No Supabase client' };
  try {
    const { error } = await client.from('diagnostico_estado').upsert({
      fn_name: 'diagnostico-total',
      status: payload?.global?.status || 'UNKNOWN',
      details: payload,
      updated_at: new Date().toISOString()
    }).select('fn_name').single();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

async function sbInsertEjecucion(row) {
  const client = await sbClient();
  if (!client) return;
  try { await client.from('diagnostico_ejecuciones').insert([row]); } catch {}
}

// ---------------- Checks externos: TODOS degradan a DOWN sin lanzar ----------------
async function checkOpenAI({ deep, authenticated }) {
  const t0 = Date.now();
  if (!OPENAI_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'OPENAI_API_KEY ausente' };
  if (!(authenticated && deep)) return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      method: 'GET', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: T_NET
    });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), http: res.status, body: (await safeText(res) || '').slice(0,160) };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) { return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) }; }
}
async function checkOddsAPI({ deep, authenticated }) {
  const t0 = Date.now();
  if (!ODDS_API_KEY) return { status: 'DOWN', ms: ms(t0), error: 'ODDS_API_KEY ausente' };
  if (!(authenticated && deep)) return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  try {
    const res = await fetchWithTimeout(`https://api.the-odds-api.com/v4/sports/?apiKey=${ODDS_API_KEY}`, { timeout: T_NET });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), http: res.status, body: (await safeText(res) || '').slice(0,160) };
    return { status: 'UP', ms: ms(t0) };
  } catch (e) { return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) }; }
}
async function checkAPIFootball({ deep, authenticated }) {
  const t0 = Date.now();
  if (!API_FOOTBALL_KEY) return { status: 'DOWN', ms: ms(t0), error: 'API_FOOTBALL_KEY ausente' };
  if (!(authenticated && deep)) return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  try {
    const res = await fetchWithTimeout('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }, timeout: T_NET
    });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), http: res.status, body: (await safeText(res) || '').slice(0,160) };
    const data = await safeJson(res);
    const apiStatus = data?.response?.subscription?.active ? 'UP' : 'WARN';
    return { status: apiStatus, ms: ms(t0) };
  } catch (e) { return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) }; }
}
async function checkTelegram({ deep, authenticated }) {
  const t0 = Date.now();
  if (!TELEGRAM_BOT_TOKEN) return { status: 'DOWN', ms: ms(t0), error: 'TELEGRAM_BOT_TOKEN ausente' };
  if (!(authenticated && deep)) return { status: 'UP', ms: 0, note: 'modo público (sin deep)' };
  try {
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, { timeout: T_NET });
    if (!res.ok) return { status: 'DOWN', ms: ms(t0), http: res.status, body: (await safeText(res) || '').slice(0,160) };
    const data = await safeJson(res);
    return { status: data?.ok === true ? 'UP' : 'DOWN', ms: ms(t0) };
  } catch (e) { return { status: 'DOWN', ms: ms(t0), error: e.message || String(e) }; }
}

// ---------------- Payload / HTML ----------------
function globalStatus(parts) {
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

function colorByStatus(st) { return st === 'UP' ? '#17c964' : st === 'WARN' ? '#f5a524' : st === 'DOWN' ? '#f31260' : '#a1a1aa'; }
function iconByStatus(st) { return st === 'UP' ? '✅' : st === 'WARN' ? '⚠️' : st === 'DOWN' ? '❌' : '•'; }
function tile(label, status, details) {
  const c = colorByStatus(status);
  return `<div class="tile">
    <div class="tile-top">
      <span class="dot" style="background:${c}"></span>
      <span class="label">${label}</span>
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

  const join = (arr) => arr.filter(Boolean).join('\n');
  const sbDetails = join([
    `status: ${supabase_basic.status}`,
    supabase_basic.error && `error: ${supabase_basic.error}`,
    supabase_basic.sample && `último pick ts: ${fmtDate(supabase_basic.sample)}`,
    `latencia: ${supabase_basic.ms} ms`
  ]);
  const openaiDetails = join([
    `status: ${checks.openai.status}`,
    checks.openai.error && `error: ${checks.openai.error}`,
    checks.openai.http && `http: ${checks.openai.http}`,
    `latencia: ${checks.openai.ms} ms`,
    checks.openai.note && `nota: ${checks.openai.note}`
  ]);
  const oddsDetails = join([
    `status: ${checks.oddsapi.status}`,
    checks.oddsapi.error && `error: ${checks.oddsapi.error}`,
    checks.oddsapi.http && `http: ${checks.oddsapi.http}`,
    `latencia: ${checks.oddsapi.ms} ms`,
    checks.oddsapi.note && `nota: ${checks.oddsapi.note}`
  ]);
  const footDetails = join([
    `status: ${checks.apifootball.status}`,
    checks.apifootball.error && `error: ${checks.apifootball.error}`,
    checks.apifootball.http && `http: ${checks.apifootball.http}`,
    `latencia: ${checks.apifootball.ms} ms`,
    checks.apifootball.note && `nota: ${checks.apifootball.note}`
  ]);
  const tgDetails = join([
    `status: ${checks.telegram.status}`,
    checks.telegram.error && `error: ${checks.telegram.error}`,
    checks.telegram.http && `http: ${checks.telegram.http}`,
    `latencia: ${checks.telegram.ms} ms`,
    checks.telegram.note && `nota: ${checks.telegram.note}`
  ]);

  const execRows = (execs || []).map(e => `
    <tr>
      <td>${htmlEscape(e.function_name)}</td>
      <td>${fmtDate(e.started_at)}</td>
      <td>${fmtDate(e.ended_at)}</td>
      <td class="num">${e.duration_ms ?? ''}</td>
      <td>${e.ok ? '✅' : '❌'}</td>
      <td>${htmlEscape(e.error_message || '')}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Sin registros</td></tr>';
  const c = colorByStatus(payload.global.status);

  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>PunterX — Diagnóstico Total</title>
<style>
  :root{--bg:#0b0b10;--card:#11131a;--muted:#9ca3af;--fg:#e5e7eb;--green:#17c964;--amber:#f5a524;--red:#f31260;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Noto Sans,sans-serif;}
  header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #1f2330;background:#0d0f16;position:sticky;top:0;z-index:10}
  .brand{display:flex;gap:10px;align-items:center}.dot{width:10px;height:10px;border-radius:50%}
  .title{font-weight:700}.subtitle{color:var(--muted);font-size:12px}
  .grid{display:grid;gap:16px;padding:20px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .tile{background:var(--card);border-radius:14px;padding:14px;border:1px solid #1f2330;box-shadow:0 0 0 1px rgba(255,255,255,0.02) inset}
  .tile-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
  .label{font-weight:600}.status{margin-left:auto;font-weight:700}
  .mono{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#d1d5db;background:#0d0f16;padding:10px;border-radius:10px;border:1px solid #1f2330}
  table.env{width:100%;border-collapse:collapse}table.env td{padding:6px 8px;border-bottom:1px dashed #1f2330;font-size:13px}
  .section{padding:0 20px 20px}.cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .card{background:var(--card);border:1px solid #1f2330;border-radius:14px;padding:14px}.muted{color:var(--muted)}
  h2{margin:12px 0;font-size:16px}table.tbl{width:100%;border-collapse:collapse}
  table.tbl th,table.tbl td{padding:8px;border-bottom:1px solid #1f2330;font-size:13px;text-align:left}
  table.tbl th{color:#cbd5e1;font-weight:700}.num{text-align:right}.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#0d0f16;border:1px solid #1f2330}
  .kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0d0f16;border:1px solid #1f2330;border-radius:6px;padding:2px 6px;font-size:12px}
  footer{padding:16px 20px;color:#94a3b8;font-size:12px;display:flex;justify-content:space-between;border-top:1px solid #1f2330}
  a{color:#93c5fd;text-decoration:none}
</style></head><body>
<header>
  <div class="brand"><span class="dot" style="background:${c}"></span>
    <div><div class="title">PunterX — Diagnóstico Total</div>
      <div class="subtitle">Estado global: <span class="pill" style="border-color:${c};color:${c}">${payload.global.status}</span></div>
    </div>
  </div>
  <div class="subtitle">${htmlEscape(payload.generated_at)} · Zona: ${htmlEscape(payload.timezone)} · Node: ${htmlEscape(payload.node)}</div>
</header>
<div class="grid">
  ${tile('Supabase', payload.supabase_basic.status, sbDetails)}
  ${tile('OpenAI', payload.checks.openai.status, openaiDetails)}
  ${tile('OddsAPI', payload.checks.oddsapi.status, oddsDetails)}
  ${tile('API‑Football', payload.checks.apifootball.status, footDetails)}
  ${tile('Telegram', payload.checks.telegram.status, tgDetails)}
</div>
<section class="section"><h2>Entorno</h2><div class="card">${envBlock}
  <div class="muted" style="margin-top:8px">*Valores sensibles en modo público aparecen enmascarados. Añade <span class="kbd">?code=…</span> para vista autenticada.</div>
</div></section>
<section class="section cards">
  <div class="card">
    <h2>Actividad de picks</h2>
    <table class="tbl"><tr><th>Hoy</th><th>Últimos 7 días</th><th>Últimos 30 días</th></tr>
      <tr><td class="num">${counts.today}</td><td class="num">${counts.last7d}</td><td class="num">${counts.last30d}</td></tr>
    </table><div class="muted" style="margin-top:8px">Fuente: <span class="kbd">picks_historicos</span></div>
  </div>
  <div class="card">
    <h2>Últimas ejecuciones</h2>
    <table class="tbl"><tr><th>Función</th><th>Inicio</th><th>Fin</th><th>ms</th><th>OK</th><th>Error</th></tr>
      ${execRows}
    </table><div class="muted" style="margin-top:8px">Fuente: <span class="kbd">diagnostico_ejecuciones</span></div>
  </div>
</section>
<footer><div>Vista: ${payload.authenticated ? 'Autenticada' : 'Pública'} ·
  <a href="?json=1${payload.authenticated ? '&code=HIDDEN' : ''}">JSON</a> ·
  <a href="?deep=1${payload.authenticated ? '&code=HIDDEN' : ''}">Deep</a> ·
  <a href="?ping=1">Ping</a></div>
  <div>© ${new Date().getFullYear()} PunterX</div></footer>
</body></html>`;
}

// ---------------- Handler ----------------
exports.handler = async (event) => {
  try {
    console.log('[DIAG] boot-ok', new Date().toISOString());

    // Ping de vida: si ?ping=1, responde al instante y evitamos cualquier otra ruta de código
    if (isPing(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ping: 'pong', ts: nowISO() }) };
    }

    const startedAt = new Date();
    const authenticated = isAuthed(event);
    const wantJSON = asJSON(event);
    const wantDeep = deepRequested(event);

    const [sbBasic, counts, execs] = await Promise.all([
      sbTestBasic(), sbCounts(), sbFetchExecs(20)
    ]);

    const checks = {
      openai: await checkOpenAI({ deep: wantDeep, authenticated }),
      oddsapi: await checkOddsAPI({ deep: wantDeep, authenticated }),
      apifootball: await checkAPIFootball({ deep: wantDeep, authenticated }),
      telegram: await checkTelegram({ deep: wantDeep, authenticated }),
    };

    const envInfo = pickEnvInfo(authenticated);
    const payload = buildPayload({ envInfo, sbBasic, counts, execs, checks, authenticated });

    const endedAt = new Date();
    try { await sbUpsertEstado(payload); } catch {}
    try {
      await sbInsertEjecucion({
        function_name: 'diagnostico-total',
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: endedAt - startedAt,
        ok: payload.global.status !== 'DOWN',
        error_message: null
      });
    } catch {}

    if (wantJSON) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload, null, 2) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(payload) };
  } catch (e) {
    const msg = (e && (e.stack || e.message)) || 'Error desconocido';
    const html = `<!doctype html><meta charset="utf-8"><title>PunterX — Diagnóstico Total (capturado)</title>
<pre style="font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">
Diagnóstico atrapó una excepción y evitó el 500.
Mensaje: ${htmlEscape(msg)}
</pre>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
  }
};
