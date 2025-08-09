// netlify/functions/diagnostico-total-v2.js
// UI V2 — Panel visual con salud de APIs, métricas y últimos picks.
//  - HTML embebido (sin dependencias externas)
//  - Responsive (móvil/desktop)
//  - Pings livianos: OddsAPI y API-FOOTBALL
//  - Supabase: métricas del día y últimos 10 picks

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// ===== ENV =====
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_MODEL_FALLBACK
} = process.env;

// Zonas y utilidades de tiempo
const TZ = 'America/Mexico_City';
function nowMx() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}
function startOfDayMx() {
  const d = nowMx();
  d.setHours(0,0,0,0);
  return d;
}
function isoLocal(date = new Date()) {
  // ISO corto y legible
  const d = new Date(date);
  return d.toISOString().replace('T',' ').slice(0,19);
}

// ===== Helpers genéricos =====
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function fetchWithRetry(url, options={}, { retries=1, backoff=300, timeoutMs=6000 }={}) {
  for (let i=0;i<=retries;i++){
    try {
      const controller = new AbortController();
      const t = setTimeout(()=>controller.abort(), timeoutMs);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(t);
      return res;
    } catch (e) {
      if (i===retries) throw e;
      await sleep(backoff*(i+1));
    }
  }
}

async function safeJson(res) { try { return await res.json(); } catch { return null; } }
async function safeText(res) { try { return await res.text(); } catch { return ''; } }

function badge(status) {
  const map = {
    ok:   { emoji:'🟢', label:'OK', class:'ok' },
    warn: { emoji:'🟡', label:'Warn', class:'warn' },
    err:  { emoji:'🔴', label:'Error', class:'err' },
    na:   { emoji:'⚪', label:'N/A', class:'na' },
  };
  return map[status] || map.na;
}

function levelColor(nivel){
  switch(nivel){
    case 'Ultra Elite': return '#7e22ce'; // morado
    case 'Élite Mundial': return '#dc2626'; // rojo
    case 'Avanzado': return '#2563eb'; // azul
    case 'Competitivo': return '#16a34a'; // verde
    case 'Informativo': return '#6b7280'; // gris
    default: return '#9ca3af';
  }
}

function htmlEscape(s=''){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ===== Conexión Supabase =====
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ===== Servicios: salud de APIs =====
async function healthOdds() {
  if (!ODDS_API_KEY) return { status:'na', msg:'Sin ODDS_API_KEY' };
  try {
    // endpoint liviano
    const url = `https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}`;
    const res = await fetchWithRetry(url, {}, { retries:1, timeoutMs:5000 });
    if (!res || !res.ok) {
      const body = res ? await safeText(res) : '';
      return { status:'err', msg:`HTTP ${res?.status||'?'}`, detail: body?.slice(0,200) };
    }
    const data = await safeJson(res);
    if (Array.isArray(data)) return { status:'ok', msg:`${data.length} deportes` };
    return { status:'warn', msg:'Respuesta inesperada' };
  } catch (e) {
    return { status:'err', msg: e?.message || 'Error' };
  }
}

async function healthAPIFootball() {
  if (!API_FOOTBALL_KEY) return { status:'na', msg:'Sin API_FOOTBALL_KEY' };
  try {
    const url = 'https://v3.football.api-sports.io/status';
    const res = await fetchWithRetry(url, {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    }, { retries:1, timeoutMs:5000 });
    if (!res || !res.ok) {
      const body = res ? await safeText(res) : '';
      return { status:'err', msg:`HTTP ${res?.status||'?'}`, detail: body?.slice(0,200) };
    }
    const data = await safeJson(res);
    const result = data?.response?.[0]?.subscription?.active;
    return { status: result ? 'ok' : 'warn', msg: result ? 'Activo' : 'Inactivo' };
  } catch (e) {
    return { status:'err', msg: e?.message || 'Error' };
  }
}

function healthOpenAI() {
  if (!OPENAI_API_KEY) return { status:'na', msg:'Sin OPENAI_API_KEY', model:'—' };
  const m = OPENAI_MODEL || 'gpt-5-mini';
  const fb = OPENAI_MODEL_FALLBACK || 'gpt-5';
  return { status:'ok', msg:'Configurado', model:`${m} (fallback: ${fb})` };
}

// ===== Supabase: métricas del día =====
async function metricsToday() {
  if (!supabase) return {
    ok:false, msg:'Supabase no configurado',
    rows:[], totals:{}, evAvg:null
  };

  const desde = startOfDayMx().toISOString();
  const hasta = nowMx().toISOString();

  // Filtramos por timestamp del día (asumiendo columna timestamp tipo timestamptz)
  const { data, error } = await supabase
    .from('picks_historicos')
    .select('evento, liga, equipos, ev, probabilidad, nivel, tipo_pick, timestamp')
    .gte('timestamp', desde)
    .lte('timestamp', hasta)
    .order('timestamp', { ascending: false });

  if (error) {
    return { ok:false, msg: error.message, rows:[], totals:{}, evAvg:null };
  }

  const rows = Array.isArray(data) ? data : [];
  const totals = {
    enviados_vip: rows.filter(r=>r.tipo_pick==='vip').length,
    enviados_free: rows.filter(r=>r.tipo_pick==='free').length,
  };
  const evVals = rows.map(r=> Number(r.ev)).filter(v=>!isNaN(v));
  const evAvg = evVals.length ? Math.round(evVals.reduce((a,b)=>a+b,0)/evVals.length) : null;

  // Distribución por nivel
  const niveles = ['Ultra Elite','Élite Mundial','Avanzado','Competitivo','Informativo'];
  const dist = {};
  for (const n of niveles) dist[n] = 0;
  for (const r of rows) {
    if (dist[r.nivel] == null) dist[r.nivel] = 0;
    dist[r.nivel]++;
  }

  return { ok:true, rows, totals, evAvg, dist, desde, hasta };
}

// ===== Render HTML =====
function renderHTML({ odds, foot, oai, metrics }) {
  const nowStr = isoLocal(nowMx());

  const oddsB = badge(odds.status);
  const footB = badge(foot.status);
  const oaiB  = badge(oai.status);

  // Semáforo general
  let globalStatus = 'ok';
  const statuses = [odds.status, foot.status, oai.status, metrics.ok ? 'ok' : 'err'];
  if (statuses.includes('err')) globalStatus = 'err';
  else if (statuses.includes('warn') || statuses.includes('na')) globalStatus = 'warn';

  const gB = badge(globalStatus);

  // Gráfica simple de distribución
  const niveles = ['Ultra Elite','Élite Mundial','Avanzado','Competitivo','Informativo'];
  const dist = metrics?.dist || {};
  const total = (niveles.reduce((a,n)=>a+(dist[n]||0),0)) || 1;

  const distBars = niveles.map(n=>{
    const v = dist[n] || 0;
    const pct = Math.round((v*100)/total);
    const color = levelColor(n);
    return `
      <div class="dist-row">
        <div class="dist-label">${n}</div>
        <div class="dist-bar">
          <div class="dist-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="dist-val">${v} (${pct}%)</div>
      </div>
    `;
  }).join('');

  const last10 = (metrics?.rows || []).slice(0,10).map(r=>{
    const color = levelColor(r.nivel);
    return `
      <tr>
        <td>${htmlEscape(r.liga||'—')}</td>
        <td>${htmlEscape(r.equipos||'—')}</td>
        <td style="color:${color};font-weight:600">${htmlEscape(r.nivel||'—')}</td>
        <td>${(r.tipo_pick==='vip')?'🎯 VIP':'📡 Free'}</td>
        <td>${(r.ev!=null?(r.ev>=0?'+':'')+r.ev+'%':'—')}</td>
        <td>${(r.probabilidad!=null?r.probabilidad+'%':'—')}</td>
        <td class="mono">${htmlEscape((r.timestamp||'').replace('T',' ').slice(0,19))}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" class="muted">Sin envíos hoy</td></tr>`;

  const evAvgTxt = (metrics?.evAvg!=null) ? ((metrics.evAvg>=0?'+':'')+metrics.evAvg+'%') : '—';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PunterX · Diagnóstico V2</title>
<style>
  :root{
    --bg:#0b1220; --panel:#121a2b; --muted:#9aa4b2; --text:#e7edf5;
    --ok:#16a34a; --warn:#eab308; --err:#ef4444; --na:#64748b;
    --card:#0f172a; --border:#1f2a44; --accent:#3b82f6;
  }
  *{ box-sizing:border-box; }
  body{
    margin:0; background:var(--bg); color:var(--text); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Apple Color Emoji","Segoe UI Emoji";
  }
  .wrap{ max-width:1080px; margin:0 auto; padding:20px; }
  h1{ font-size:24px; margin:0 0 12px; display:flex; align-items:center; gap:10px;}
  .muted{ color:var(--muted); }
  .cards{ display:grid; grid-template-columns: repeat(1,minmax(0,1fr)); gap:12px; }
  @media (min-width:720px){ .cards{ grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @media (min-width:1024px){ .cards{ grid-template-columns: repeat(4,minmax(0,1fr)); } }
  .card{
    background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:14px; min-height:96px;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.02) inset;
  }
  .card h3{ margin:0 0 6px; font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:#cbd5e1;}
  .big{ font-size:28px; font-weight:700; }
  .small{ font-size:12px; line-height:1.2; color:var(--muted); }
  .row{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .badge{ font-size:12px; padding:4px 8px; border-radius:999px; font-weight:600; border:1px solid var(--border); display:inline-flex; align-items:center; gap:6px; }
  .ok{ background:rgba(22,163,74,.12); color:#4ade80; }
  .warn{ background:rgba(234,179,8,.12); color:#fde047; }
  .err{ background:rgba(239,68,68,.12); color:#fca5a5; }
  .na{ background:rgba(100,116,139,.14); color:#cbd5e1; }
  .grid2{ display:grid; grid-template-columns:1fr; gap:12px; }
  @media (min-width:900px){ .grid2{ grid-template-columns:1fr 1fr; } }
  table{ width:100%; border-collapse: collapse; }
  th, td{ padding:10px; border-bottom:1px solid var(--border); font-size:13px; vertical-align:top; }
  th{ text-align:left; color:#cbd5e1; font-weight:600; }
  tr:hover td{ background:#0f172a; }
  .mono{ font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace; }
  .dist-row{ display:grid; grid-template-columns: 160px 1fr 80px; gap:8px; align-items:center; margin:8px 0; }
  .dist-label{ font-size:13px; color:#cbd5e1; }
  .dist-bar{ height:14px; background:#0b1220; border:1px solid var(--border); border-radius:999px; overflow:hidden; }
  .dist-fill{ height:100%; }
  .footer{ margin-top:20px; font-size:12px; color:var(--muted); display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .head{ display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
  .head .title{ display:flex; align-items:center; gap:12px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div class="title">
        <h1>🧭 PunterX · Diagnóstico <span class="muted">V2</span></h1>
        <span class="badge ${gB.class}">${gB.emoji} ${gB.label}</span>
      </div>
      <div class="small">Actualizado: <span class="mono">${htmlEscape(nowStr)}</span> (CDMX)</div>
    </div>

    <div class="cards">
      <div class="card">
        <h3>OddsAPI</h3>
        <div class="row">
          <div class="big">Estado</div>
          <span class="badge ${oddsB.class}">${oddsB.emoji} ${oddsB.label}</span>
        </div>
        <div class="small">${htmlEscape(odds.msg||'')}</div>
      </div>

      <div class="card">
        <h3>API-FOOTBALL</h3>
        <div class="row">
          <div class="big">Estado</div>
          <span class="badge ${footB.class}">${footB.emoji} ${footB.label}</span>
        </div>
        <div class="small">${htmlEscape(foot.msg||'')}</div>
      </div>

      <div class="card">
        <h3>OpenAI</h3>
        <div class="row">
          <div class="big">Modelo</div>
          <span class="badge ${oaiB.class}">${oaiB.emoji} ${oaiB.label}</span>
        </div>
        <div class="small">${htmlEscape(oai.model || oai.msg || '')}</div>
      </div>

      <div class="card">
        <h3>Métricas de hoy</h3>
        <div class="row">
          <div class="big">${(metrics?.totals?.enviados_vip || 0) + (metrics?.totals?.enviados_free || 0)}</div>
          <div class="small">Envíos totales</div>
        </div>
        <div class="small">
          VIP: <b>${metrics?.totals?.enviados_vip || 0}</b> · Free: <b>${metrics?.totals?.enviados_free || 0}</b><br/>
          EV promedio: <b>${(metrics?.evAvg!=null)? ((metrics.evAvg>=0?'+':'')+metrics.evAvg+'%') : '—'}</b>
        </div>
      </div>
    </div>

    <div class="grid2" style="margin-top:16px">
      <div class="card">
        <h3>Distribución por nivel (hoy)</h3>
        ${distBars}
      </div>

      <div class="card">
        <h3>Ventana consultada</h3>
        <div class="small">
          Desde: <span class="mono">${htmlEscape(metrics?.desde || '—')}</span><br/>
          Hasta: <span class="mono">${htmlEscape(metrics?.hasta || '—')}</span><br/>
          Zona: <span class="mono">America/Mexico_City</span>
        </div>
        <div style="margin-top:10px" class="small muted">
          Alertas automáticas:
          <ul>
            <li>🟡 EV promedio &lt; 15% (investigar mercados/ligas).</li>
            <li>🟡 0 envíos hoy (revisar cron 15 min y ventana 45–55).</li>
            <li>🔴 API con estado Error (reintentos o credenciales).</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Últimos 10 picks (hoy)</h3>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Liga/País</th>
              <th>Equipos</th>
              <th>Nivel</th>
              <th>Destino</th>
              <th>EV</th>
              <th>Prob.</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            ${last10}
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">
      <div>© PunterX — Panel de diagnóstico (V2).</div>
      <div>Modelos: <span class="mono">${htmlEscape(oai.model||'—')}</span></div>
    </div>
  </div>
</body>
</html>`;
}

// ===== Handler =====
exports.handler = async () => {
  try {
    const [odds, foot, oai, metrics] = await Promise.all([
      healthOdds(),
      healthAPIFootball(),
      Promise.resolve(healthOpenAI()),
      metricsToday()
    ]);

    const html = renderHTML({ odds, foot, oai, metrics });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: html
    };
  } catch (e) {
    const errHtml = `
      <pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;white-space:pre-wrap">
      Error: ${htmlEscape(e?.message||String(e))}
      </pre>`;
    return { statusCode: 500, headers: { 'Content-Type':'text/html' }, body: errHtml };
  }
};
