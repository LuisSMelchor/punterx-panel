// netlify/functions/diagnostico-total.js
// Dashboard PRO con modo rápido (gratis) y modo profundo (?deep=1).
// Soporta ?json=1 para salida JSON (machine-friendly).

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  TELEGRAM_BOT_TOKEN,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FUNCIONES = [
  // Añade aquí las funciones que quieras monitorear
  'autopick-vip-nuevo',
  'autopick-vip-nuevo-background',
  'autopick-outrights',
  'analisis-semanal',
  'diagnostico-total',
];

function respond(statusCode, body, asJson = false) {
  return {
    statusCode,
    headers: {
      'content-type': asJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: asJson ? JSON.stringify(body, null, 2) : body,
  };
}

function badge(status) {
  const c =
    status === 'UP' || status === 'ok' ? '#16a34a' :
    status === 'DEGRADED' || status === 'warn' ? '#f59e0b' :
    '#dc2626';
  return `<span style="padding:2px 8px;border-radius:999px;background:${c};color:#fff;font-weight:600">${status}</span>`;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

async function estadoSupabase() {
  try {
    const { error } = await supabase.from('picks_historicos').select('id').limit(1);
    return error ? 'DOWN' : 'UP';
  } catch { return 'DOWN'; }
}

async function estadoOpenAI({ deep } = {}) {
  if (!OPENAI_API_KEY) return 'DOWN';
  if (!deep) return 'UP';
  try {
    const t0 = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // barato/estable; ajusta si usas otro
        messages: [{ role: 'user', content: 'pong' }],
        max_tokens: 1,
      }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) return { status: 'DEGRADED', ms };
    return { status: 'UP', ms };
  } catch {
    return { status: 'DEGRADED', ms: null };
  }
}

async function estadoTelegram({ deep } = {}) {
  if (!TELEGRAM_BOT_TOKEN) return 'DOWN';
  if (!deep) return 'UP';
  try {
    const t0 = Date.now();
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const ms = Date.now() - t0;
    if (!r.ok) return { status: 'DEGRADED', ms };
    const j = await r.json().catch(() => ({}));
    return (j && j.ok) ? { status: 'UP', ms } : { status: 'DEGRADED', ms };
  } catch {
    return { status: 'DEGRADED', ms: null };
  }
}

async function estadoOddsAPI() { return ODDS_API_KEY ? 'UP' : 'DOWN'; }
async function estadoAPIFootball() { return API_FOOTBALL_KEY ? 'UP' : 'DOWN'; }

async function resumenHoy() {
  try {
    const today = ymd(new Date());
    const { data } = await supabase
      .from('picks_historicos')
      .select('ev, timestamp')
      .gte('timestamp', `${today}T00:00:00.000Z`)
      .lte('timestamp', `${today}T23:59:59.999Z`);
    const arr = data || [];
    const enviados = arr.length;
    const ev_prom = enviados ? Math.round(arr.reduce((a, b) => a + (b.ev || 0), 0) / enviados) : 0;
    return { enviados, ev_prom };
  } catch { return { enviados: 0, ev_prom: 0 }; }
}

async function resumenWinRate(windowDias) {
  try {
    const desdeISO = new Date(Date.now() - windowDias * 86400000).toISOString();
    // preferir memoria_resumen si existe
    const { data } = await supabase
      .from('memoria_resumen')
      .select('hit_rate, ev_prom, samples')
      .eq('window_dias', windowDias)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (data && data.length) {
      const r = data[0];
      return { hit: r.hit_rate || 0, ev_prom: r.ev_prom || 0, samples: r.samples || 0 };
    }
    // fallback: contar en resultados_partidos
    const { data: res } = await supabase
      .from('resultados_partidos')
      .select('resultado, ev, fecha_liq')
      .gte('fecha_liq', desdeISO);
    const arr = res || [];
    const tot = arr.length;
    const wins = arr.filter(x => x.resultado === 'win').length;
    const hit = tot ? Math.round((wins * 100) / tot) : 0;
    const ev_prom = tot ? Math.round(arr.reduce((a, b) => a + (b.ev || 0), 0) / tot) : 0;
    return { hit, ev_prom, samples: tot };
  } catch {
    return { hit: 0, ev_prom: 0, samples: 0 };
  }
}

// Heartbeats (última ejecución por función) – tabla opcional heartbeats:
// columns: function_name(text), last_seen(timestamptz), ok(boolean)
// Cada función debería upsert al empezar.
async function getHeartbeats() {
  try {
    const { data, error } = await supabase
      .from('heartbeats')
      .select('function_name,last_seen,ok')
      .in('function_name', FUNCIONES);
    if (error) throw error;
    const map = Object.fromEntries((data || []).map(r => [r.function_name, r]));
    return FUNCIONES.map(name => {
      const r = map[name];
      return {
        name,
        last_seen: r?.last_seen || null,
        ok: r?.ok ?? null,
      };
    });
  } catch {
    // si no existe la tabla, devolvemos “desconocido” pero no rompemos
    return FUNCIONES.map(name => ({ name, last_seen: null, ok: null }));
  }
}

// Telemetría de costos opcional – tabla cost_telemetry(provider, usd, ts)
async function getCosts(days = 30) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await supabase
      .from('cost_telemetry')
      .select('provider, usd, ts')
      .gte('ts', since);
    if (error) throw error;
    const total = (data || []).reduce((a, b) => a + (Number(b.usd) || 0), 0);
    const porProveedor = {};
    (data || []).forEach(r => {
      porProveedor[r.provider] = (porProveedor[r.provider] || 0) + (Number(r.usd) || 0);
    });
    return { total: Number(total.toFixed(4)), porProveedor };
  } catch {
    return { total: null, porProveedor: null }; // N/A si no existe
  }
}

function htmlPage(model) {
  const {
    fast,
    states, // { supabase, openai, openai_ms, telegram, telegram_ms, odds, apifootball }
    today, last7, last30,
    beats, // [{name,last_seen,ok}]
    costs, // {total,porProveedor}
    generatedAt,
  } = model;

  const rowBeat = b => {
    const s = b.ok === null ? 'UNKNOWN' : b.ok ? 'UP' : 'DOWN';
    const pill = badge(s === 'UNKNOWN' ? 'DEGRADED' : s);
    const when = b.last_seen ? new Date(b.last_seen).toLocaleString() : '—';
    return `<tr>
      <td style="padding:8px 12px;">${b.name}</td>
      <td style="padding:8px 12px;">${when}</td>
      <td style="padding:8px 12px;">${pill}</td>
    </tr>`;
  };

  const costBox = costs.total === null
    ? `<p class="muted">Costos (últimos 30 días): N/A (sin tabla cost_telemetry)</p>`
    : `<p>Costos 30d: <b>$${costs.total}</b></p>
       <div class="muted">${
         Object.entries(costs.porProveedor)
           .map(([k, v]) => `${k}: $${v.toFixed(4)}`)
           .join(' · ')
       }</div>`;

  const deepNote = fast
    ? `<div class="muted">Modo rápido (sin pings a proveedores). <a href="?deep=1">Cambiar a modo profundo</a></div>`
    : `<div class="muted">Modo profundo: latencias — OpenAI ${states.openai_ms ?? '—'} ms · Telegram ${states.telegram_ms ?? '—'} ms. <a href="?">Cambiar a modo rápido</a></div>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>PunterX · Diagnóstico</title>
<style>
  :root{--bg:#0b0f17;--panel:#0f172a;--card:#111827;--b:#1f2937;--fg:#e5e7eb;--muted:#9ca3af;--accent:#93c5fd}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;align-items:stretch}
  .card{background:var(--card);border:1px solid var(--b);border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.25)}
  h1{font-size:22px;margin:0 0 16px}
  h3{font-size:16px;margin:0 0 8px;color:var(--accent)}
  p{margin:6px 0}
  .muted{color:var(--muted)}
  table{width:100%;border-collapse:collapse;border-spacing:0}
  th,td{border-top:1px solid var(--b);font-size:14px}
  th{color:var(--muted);text-align:left;padding:8px 12px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .kv{background:var(--panel);border:1px solid var(--b);border-radius:12px;padding:8px 10px;font-size:13px}
  a{color:#60a5fa;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
  <h1>Diagnóstico PunterX</h1>

  <div class="row" style="margin-bottom:12px">
    <div class="kv">Supabase ${badge(states.supabase)}</div>
    <div class="kv">OpenAI ${typeof states.openai==='string' ? badge(states.openai) : badge(states.openai.status)}</div>
    <div class="kv">OddsAPI ${badge(states.odds)}</div>
    <div class="kv">API-Football ${badge(states.apifootball)}</div>
    <div class="kv">Telegram ${typeof states.telegram==='string' ? badge(states.telegram) : badge(states.telegram.status)}</div>
  </div>

  ${deepNote}

  <div class="grid" style="margin-top:12px">
    <div class="card">
      <h3>Hoy</h3>
      <p>Enviados: <b>${today.enviados}</b></p>
      <p>EV Promedio: <b>${today.ev_prom}%</b></p>
      ${costBox}
    </div>
    <div class="card">
      <h3>Últimos 7 días</h3>
      <p>Hit Rate: <b>${last7.hit}%</b></p>
      <p>EV Promedio: <b>${last7.ev_prom}%</b></p>
      <p class="muted">Muestras: ${last7.samples}</p>
    </div>
    <div class="card">
      <h3>Últimos 30 días</h3>
      <p>Hit Rate: <b>${last30.hit}%</b></p>
      <p>EV Promedio: <b>${last30.ev_prom}%</b></p>
      <p class="muted">Muestras: ${last30.samples}</p>
    </div>
    <div class="card">
      <h3>Funciones (heartbeats)</h3>
      <table>
        <thead><tr><th>Función</th><th>Último seen</th><th>Estado</th></tr></thead>
        <tbody>
          ${beats.map(rowBeat).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <p class="muted" style="margin-top:16px">Actualizado: ${new Date(generatedAt).toLocaleString()} · <a href="?json=1${fast ? '' : '&deep=1'}">Ver JSON</a></p>
</body>
</html>`;
}

exports.handler = async (evt) => {
  const rawUrl = evt?.rawUrl || `http://x/?${evt?.rawQuery || ''}`;
  const url = new URL(rawUrl);
  const deep = url.searchParams.get('deep') === '1';
  const asJson = url.searchParams.get('json') === '1';

  try {
    // Estados (modo rápido vs profundo)
    const [sb, odds, foot] = await Promise.all([
      estadoSupabase(),
      estadoOddsAPI(),
      estadoAPIFootball(),
    ]);

    const oai = await estadoOpenAI({ deep });
    const tg  = await estadoTelegram({ deep });

    const [today, last7, last30, beats, costs] = await Promise.all([
      resumenHoy(),
      resumenWinRate(7),
      resumenWinRate(30),
      getHeartbeats(),
      getCosts(30),
    ]);

    const model = {
      fast: !deep,
      generatedAt: new Date().toISOString(),
      states: {
        supabase: sb,
        openai: typeof oai === 'string' ? oai : oai.status,
        openai_ms: typeof oai === 'object' ? oai.ms : null,
        telegram: typeof tg === 'string' ? tg : tg.status,
        telegram_ms: typeof tg === 'object' ? tg.ms : null,
        odds,
        apifootball: foot,
      },
      today,
      last7,
      last30,
      beats,
      costs,
    };

    if (asJson) return respond(200, model, true);
    return respond(200, htmlPage(model), false);
  } catch (e) {
    const msg = e?.message || String(e);
    if (asJson) return respond(500, { error: msg }, true);
    return respond(500, `<!doctype html><pre style="color:#fca5a5">Error: ${msg}</pre>`, false);
  }
};
