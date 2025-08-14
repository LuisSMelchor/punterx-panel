// netlify/functions/analisis-semanal.js
// Resumen semanal de actividad de picks — usa shim de Supabase (singleton).
// GET  /.netlify/functions/analisis-semanal
// JSON /.netlify/functions/analisis-semanal?json=1

// --- BLINDAJE RUNTIME: fetch + trampas globales (añadir al inicio del archivo) ---
try {
  if (typeof fetch === 'undefined') {
    // Polyfill para runtimes/lambdas donde fetch aún no está disponible
    global.fetch = require('node-fetch');
  }
} catch (_) { /* no-op */ }

try {
  // Evita “Internal Error” si algo revienta antes del handler
  process.on('uncaughtException', (e) => {
    try { console.error('[UNCAUGHT]', e && (e.stack || e.message || e)); } catch {}
  });
  process.on('unhandledRejection', (e) => {
    try { console.error('[UNHANDLED]', e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) { /* no-op */ }
// --- FIN BLINDAJE RUNTIME ---

const getSupabase = require('./_supabase-client.cjs');

const { TZ } = process.env;
const SITE_TZ = TZ || 'America/Mexico_City';

const nowISO = () => new Date().toISOString();
const ms = (t0) => Date.now() - t0;

function htmlEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleString('es-MX', { timeZone: SITE_TZ, hour12: false });
  } catch { return d || ''; }
}
function asJSON(event) { return !!((event.queryStringParameters || {}).json); }

async function getClient() {
  try { return await getSupabase(); }
  catch (e) { console.error('[SEMANA] Supabase shim error:', e?.message || e); return null; }
}

async function loadWeeklyStats() {
  const t0 = Date.now();
  const supabase = await getClient();
  if (!supabase) {
    return { ok: false, ms: ms(t0), error: 'Supabase no disponible' };
  }

  const now = new Date();
  const start7 = new Date(now.getTime() - 7 * 86400000);
  const iso7 = start7.toISOString();

  // Ajusta nombres de campos si difieren en tu esquema real
  const cols = `
    id, timestamp, ev, resultado, liga, pais, tipo, probabilidad_estim, apuesta
  `;

  const { data, error } = await supabase
    .from('picks_historicos')
    .select(cols)
    .gte('timestamp', iso7)
    .order('timestamp', { ascending: false });

  if (error) return { ok: false, ms: ms(t0), error: error.message };

  const total = data.length;
  const ganados = data.filter(r => r.resultado === 'ganado').length;
  const perdidos = data.filter(r => r.resultado === 'perdido').length;
  const pendientes = data.filter(r => r.resultado === 'pendiente').length;
  const evProm = Number(
    (data.reduce((acc, r) => acc + (Number(r.ev) || 0), 0) / (total || 1)).toFixed(2)
  );

  return {
    ok: true,
    ms: ms(t0),
    rango: { desde: iso7, hasta: nowISO() },
    totales: { total, ganados, perdidos, pendientes, evProm },
    muestra: data.slice(0, 25) // top 25 recientes para vista rápida
  };
}

function renderHTML(payload) {
  const { rango, totales, muestra } = payload;
  return `<!doctype html>
<meta charset="utf-8">
<title>PunterX — Análisis Semanal</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  h1{font-size:18px}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;font-size:13px}
  .muted{color:#94a3b8}
</style>
<div class="card">
  <h1>Resumen semanal</h1>
  <div class="muted">Rango: ${fmtDate(rango.desde)} → ${fmtDate(rango.hasta)}</div>
  <p>
    Total: <b>${totales.total}</b> · Ganados: <b>${totales.ganados}</b> ·
    Perdidos: <b>${totales.perdidos}</b> · Pendientes: <b>${totales.pendientes}</b> ·
    EV prom.: <b>${totales.evProm}%</b>
  </p>
</div>
<div class="card">
  <h2>Últimos 25 picks</h2>
  <table>
    <tr>
      <th>Fecha</th><th>Tipo</th><th>Apuesta</th><th>Liga</th><th>EV</th><th>Resultado</th>
    </tr>
    ${muestra.map(r => `
      <tr>
        <td>${fmtDate(r.timestamp)}</td>
        <td>${htmlEscape(r.tipo || '')}</td>
        <td>${htmlEscape(r.apuesta || '')}</td>
        <td>${htmlEscape([r.pais, r.liga].filter(Boolean).join(' - '))}</td>
        <td>${Number(r.ev || 0).toFixed(2)}%</td>
        <td>${htmlEscape(r.resultado || '')}</td>
      </tr>
    `).join('')}
  </table>
</div>`;
}

exports.handler = async (event) => {
  try {
    const result = await loadWeeklyStats();
    if (!result.ok) {
      const body = { ok: false, error: result.error, ms: result.ms };
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: renderHTML(result) };
  } catch (e) {
    const msg = e?.message || String(e);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: msg }) };
  }
};
