// netlify/functions/diagnostico-total.js
// Panel rápido con métricas diarias/7/30 días y estado de integraciones.
// Render simple en HTML (puedes mejorar estilos luego).

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const {
  SUPABASE_URL, SUPABASE_KEY,
  OPENAI_API_KEY, TELEGRAM_BOT_TOKEN,
  ODDS_API_KEY, API_FOOTBALL_KEY
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function html(statusCode, content) {
  return { statusCode, headers: { 'content-type': 'text/html; charset=utf-8' }, body: content };
}

function statusBadge(s) {
  const c = s === 'UP' ? '#16a34a' : s === 'DEGRADED' ? '#f59e0b' : '#ef4444';
  return `<span style="padding:2px 8px;border-radius:12px;background:${c};color:#fff;font-weight:600">${s}</span>`;
}

function dateYMD(d=new Date()) {
  const z=n=>String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth()+1)}-${z(d.getUTCDate())}`;
}

async function estadoSupabase() {
  try {
    const { error } = await supabase.from('picks_historicos').select('id').limit(1);
    if (error) return 'DOWN';
    return 'UP';
  } catch { return 'DOWN'; }
}
async function estadoOpenAI() {
  // Sin llamar a la API (para no gastar): verificar key presente.
  return OPENAI_API_KEY ? 'UP' : 'DOWN';
}
async function estadoOddsAPI() {
  // Check superficial: si hay key → DEGRADED/UP (no llamamos para evitar cuota)
  return ODDS_API_KEY ? 'UP' : 'DOWN';
}
async function estadoAPIFootball() {
  return API_FOOTBALL_KEY ? 'UP' : 'DOWN';
}
async function estadoTelegram() {
  return TELEGRAM_BOT_TOKEN ? 'UP' : 'DOWN';
}

async function resumenHoy() {
  try {
    const today = dateYMD(new Date());
    const { data } = await supabase
      .from('picks_historicos')
      .select('ev')
      .gte('timestamp', `${today}T00:00:00.000Z`)
      .lte('timestamp', `${today}T23:59:59.999Z`);
    const enviados = (data||[]).length;
    const ev_prom = enviados ? Math.round((data.reduce((a,b)=>a+(b.ev||0),0)/enviados)) : 0;
    return { enviados, ev_prom };
  } catch { return { enviados: 0, ev_prom: 0 }; }
}

async function resumenWinRate(windowDias) {
  try {
    const desde = new Date(Date.now() - windowDias*24*60*60*1000).toISOString();
    // Si tienes memoria_resumen, úsala
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
    // Fallback simple: contar resultados directos
    const { data: res } = await supabase
      .from('resultados_partidos')
      .select('resultado, ev, fecha_liq')
      .gte('fecha_liq', desde);
    const arr = res || [];
    const tot = arr.length || 0;
    const wins = arr.filter(x => x.resultado === 'win').length;
    const hit = tot ? Math.round(wins*100/tot) : 0;
    const ev_prom = tot ? Math.round(arr.reduce((a,b)=>a+(b.ev||0),0)/tot) : 0;
    return { hit, ev_prom, samples: tot };
  } catch { return { hit: 0, ev_prom: 0, samples: 0 }; }
}

exports.handler = async () => {
  try {
    const [sb, oai, odds, foot, tg] = await Promise.all([
      estadoSupabase(), estadoOpenAI(), estadoOddsAPI(), estadoAPIFootball(), estadoTelegram()
    ]);

    const [hoy, ult7, ult30] = await Promise.all([
      resumenHoy(), resumenWinRate(7), resumenWinRate(30)
    ]);

    const htmlOut = `
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>PunterX · Diagnóstico</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#0b0f17;color:#e5e7eb;margin:0;padding:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;align-items:stretch}
  .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.2)}
  h1{font-size:20px;margin:0 0 16px}
  h3{font-size:16px;margin:0 0 8px;color:#93c5fd}
  p{margin:4px 0}
  .muted{color:#9ca3af}
</style>
</head>
<body>
  <h1>Diagnóstico PunterX</h1>
  <div class="grid">
    <div class="card">
      <h3>Hoy</h3>
      <p>Enviados: <b>${hoy.enviados}</b></p>
      <p>EV Promedio: <b>${hoy.ev_prom}%</b></p>
    </div>
    <div class="card">
      <h3>Últimos 7 días</h3>
      <p>Hit Rate: <b>${ult7.hit}%</b></p>
      <p>EV Promedio: <b>${ult7.ev_prom}%</b></p>
      <p class="muted">Muestras: ${ult7.samples}</p>
    </div>
    <div class="card">
      <h3>Últimos 30 días</h3>
      <p>Hit Rate: <b>${ult30.hit}%</b></p>
      <p>EV Promedio: <b>${ult30.ev_prom}%</b></p>
      <p class="muted">Muestras: ${ult30.samples}</p>
    </div>
    <div class="card">
      <h3>Integraciones</h3>
      <p>Supabase: ${statusBadge(sb)}</p>
      <p>OpenAI: ${statusBadge(oai)}</p>
      <p>OddsAPI: ${statusBadge(odds)}</p>
      <p>API-Football: ${statusBadge(foot)}</p>
      <p>Telegram: ${statusBadge(tg)}</p>
    </div>
  </div>

  <p class="muted" style="margin-top:16px">Actualizado: ${new Date().toLocaleString()}</p>
</body>
</html>`.trim();

    return html(200, htmlOut);
  } catch (e) {
    const msg = e?.message || String(e);
    return html(500, `<pre style="color:#fca5a5">Error: ${msg}</pre>`);
  }
};
