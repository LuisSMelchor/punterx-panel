// netlify/functions/_diag-core-v4.cjs
// Diagnóstico PunterX — UI pro + actividad de picks + telemetría + errores
// Montreal por defecto · Build tag visible (v4)

const DIAG_BUILD_TAG = 'PunterX diag v4';

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

// ============ CHECKS EXTERNOS ============
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

// ============ ACTIVIDAD (picks_historicos) ============
function safeGet(row, keys, fallback='—') {
  for (const k of keys) {
    if (k in row && row[k] != null && row[k] !== '') return row[k];
  }
  return fallback;
}
function classifyVIP(ev) {
  if (typeof ev !== 'number' || Number.isNaN(ev)) return '—';
  if (ev >= 40) return '🟣 Ultra Élite';
  if (ev >= 30) return '🎯 Élite Mundial';
  if (ev >= 20) return '🥈 Avanzado';
  if (ev >= 15) return '🥉 Competitivo';
  if (ev >= 10) return 'FREE (10–14.9%)';
  return 'Descartado (<10%)';
}

async function fetchPicksSnapshot({ limit = 30, hours = 24 } = {}) {
  const t0 = Date.now();
  try {
    const supabase = await getSupabase();
    const sinceISO = new Date(Date.now() - hours * 3600e3).toISOString();

    let q = supabase.from('picks_historicos')
      .select('*')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false })
      .limit(limit);

    let { data, error } = await q;
    if (error) {
      q = supabase.from('picks_historicos').select('*').order('id', { ascending: false }).limit(limit);
      const alt = await q; data = alt.data; error = alt.error;
    }
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const mapped = rows.map(r => {
      const liga = safeGet(r, ['liga','league','competencia','tournament']);
      const pais = safeGet(r, ['pais','country']);
      const apuesta = safeGet(r, ['apuesta','seleccion','market','pick','seleccion_sugerida']);
      const ev = Number(safeGet(r, ['ev','ev_percent','valor_ev','value_ev'], NaN));
      const prob = Number(safeGet(r, ['prob','prob_est','probabilidad','probabilidad_estimada'], NaN));
      const canal = safeGet(r, ['canal','tipo','nivel','destino']);
      const fecha = safeGet(r, ['created_at','fecha','inserted_at','ts','timestamp'], nowISO());
      const id = safeGet(r, ['id','uuid'], '—');
      return { id, liga, pais, apuesta, ev, prob, canal, fecha, vipNivel: classifyVIP(ev) };
    });

    const total = mapped.length;
    const withEV = mapped.filter(x => !Number.isNaN(x.ev));
    const ev_avg = withEV.length ? Number((withEV.reduce((a,b)=>a+b.ev,0)/withEV.length).toFixed(2)) : null;

    const nivelesCount = {
      '🟣 Ultra Élite': mapped.filter(x=>x.vipNivel==='🟣 Ultra Élite').length,
      '🎯 Élite Mundial': mapped.filter(x=>x.vipNivel==='🎯 Élite Mundial').length,
      '🥈 Avanzado': mapped.filter(x=>x.vipNivel==='🥈 Avanzado').length,
      '🥉 Competitivo': mapped.filter(x=>x.vipNivel==='🥉 Competitivo').length,
      'FREE (10–14.9%)': mapped.filter(x=>x.vipNivel==='FREE (10–14.9%)').length,
      'Descartado (<10%)': mapped.filter(x=>x.vipNivel==='Descartado (<10%)').length
    };

    const top_ligas_map = mapped.reduce((acc, x)=>{
      const k = (x.pais || '—') + ' • ' + (x.liga || '—');
      acc[k] = (acc[k]||0)+1; return acc;
    }, {});
    const top_ligas = Object.entries(top_ligas_map).sort((a,b)=>b[1]-a[1]).slice(0,6);

    // Buckets EV
    const buckets = { '<10':0, '10-14.9':0, '15-19.9':0, '20-29.9':0, '30-39.9':0, '≥40':0 };
    for (const x of withEV) {
      const e = x.ev;
      if (e < 10) buckets['<10']++;
      else if (e < 15) buckets['10-14.9']++;
      else if (e < 20) buckets['15-19.9']++;
      else if (e < 30) buckets['20-29.9']++;
      else if (e < 40) buckets['30-39.9']++;
      else buckets['≥40']++;
    }

    return { ok:true, took_ms: ms(t0), rows: mapped, metrics: {
      total,
      vip: mapped.filter(x => String(x.canal||'').toLowerCase().includes('vip')).length,
      free: mapped.filter(x => String(x.canal||'').toLowerCase().includes('free')).length,
      ev_avg,
      niveles: nivelesCount,
      top_ligas,
      ev_buckets: buckets
    }};
  } catch (e) {
    return { ok:false, took_ms: ms(t0), error: e?.message || String(e) };
  }
}

// ============ TELEMETRÍA (opcional) ============
async function fetchTelemetriaCiclos({ limit = 20 } = {}) {
  const t0 = Date.now();
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('telemetria_ciclos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return { ok:true, took_ms: ms(t0), rows };
  } catch (e) {
    return { ok:false, took_ms: ms(t0), error: e?.message || String(e) };
  }
}

// ============ ERRORES (opcional) ============
async function fetchErrores({ limit = 10 } = {}) {
  const t0 = Date.now();
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('errores_funciones')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return { ok:true, took_ms: ms(t0), rows };
  } catch (e) {
    return { ok:false, took_ms: ms(t0), error: e?.message || String(e) };
  }
}

// ============ PAYLOAD ============
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
    build: DIAG_BUILD_TAG,
    node: NODE_VERSION || process.version,
    tz: SITE_TZ,
    env_presence,
    env_masked,
    checks,
    global
  };
}

// ============ RENDER ============
function renderHTML(payload) {
  const ok = payload.global === 'UP';
  const statusColor = ok ? '#17c964' : '#f59f00';
  const bg = '#0b0d12', card = '#0f121a', border = '#1b2233', text = '#EAEFF7', muted = '#9AA8BF';
  const htmlEscape = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));

  const rowsEnv = Object.entries(payload.env_presence).map(([k,v]) => {
    const masked = payload.env_masked[k] ?? '';
    return '<tr><td>'+k+'</td><td>'+(v ? '✅' : '❌')+'</td><td class="muted">'+htmlEscape(masked)+'</td></tr>';
  }).join('');

  const rowsChecks = Object.entries(payload.checks).map(([k,obj]) => {
    const stColor = (obj.status==='UP' ? '#16a34a' : '#f59f00');
    let details = '';
    if (obj.details) details = '<div class="check-row"><span>detalles</span><pre class="code">'+htmlEscape(JSON.stringify(obj.details, null, 2))+'</pre></div>';
    let err = '';
    if (obj.error) err = '<div class="check-row"><span>error</span><code class="code">'+htmlEscape(obj.error)+'</code></div>';
    return ''
      + '<div class="check-card">'
      +   '<div class="check-title">'+k+'</div>'
      +   '<div class="check-row"><span>status</span><b style="color:'+stColor+'">'+htmlEscape(obj.status)+'</b></div>'
      +   '<div class="check-row"><span>latencia</span><code>'+htmlEscape(String(obj.ms || 0))+' ms</code></div>'
      +   err + details
      + '</div>';
  }).join('');

  // Secciones opcionales
  const act = payload.activity;
  const tele = payload.telemetria;
  const errs = payload.errores;

  // Actividad de picks (si existe)
  let picksSection = '';
  if (act && act.ok) {
    const a = act;
    const meters = Object.entries(a.metrics.niveles || {}).map(([label, n]) => {
      const width = Math.min(100, (a.metrics.total ? (n*100/a.metrics.total) : 0));
      return '<div class="meter"><span>'+htmlEscape(label)+'</span><div class="bar"><i style="width:'+width+'%"></i></div><b>'+n+'</b></div>';
    }).join('');
    const topLigas = (a.metrics.top_ligas || []).map(([k, n]) => '<li><span>'+htmlEscape(k)+'</span><b>'+n+'</b></li>').join('');
    const evBuckets = Object.entries(a.metrics.ev_buckets || {}).map(([k,v])=>{
      const width = Math.min(100, (a.metrics.total ? (v*100/a.metrics.total) : 0));
      return '<div class="meter"><span>EV '+htmlEscape(k)+'</span><div class="bar"><i style="width:'+width+'%"></i></div><b>'+v+'</b></div>';
    }).join('');
    const rows = (a.rows || []).map(row => {
      const ev = Number.isNaN(row.ev) ? '—' : (row.ev.toFixed(2)+'%');
      const prob = Number.isNaN(row.prob) ? '—' : (row.prob.toFixed(1)+'%');
      return ''
        + '<tr>'
        +   '<td>'+htmlEscape(row.pais)+' • '+htmlEscape(row.liga)+'</td>'
        +   '<td><code class="code">'+htmlEscape(String(row.apuesta))+'</code></td>'
        +   '<td>'+ev+'</td>'
        +   '<td>'+prob+'</td>'
        +   '<td>'+htmlEscape(row.vipNivel)+'</td>'
        +   '<td><span class="pill">'+htmlEscape(String(row.canal||'—').toUpperCase())+'</span></td>'
        +   '<td class="muted">'+htmlEscape(row.fecha)+'</td>'
        + '</tr>';
    }).join('');

    picksSection =
      '<div class="card">'
      + '<h2 style="margin-top:0">Actividad de picks (últ. '+htmlEscape(String(a.window_hours))+' h)</h2>'
      + '<div class="stats">'
      +   '<div class="stat"><div class="stat-kpi">'+a.metrics.total+'</div><div class="stat-label">Total picks</div></div>'
      +   '<div class="stat"><div class="stat-kpi">'+a.metrics.vip+'</div><div class="stat-label">Enviados VIP</div></div>'
      +   '<div class="stat"><div class="stat-kpi">'+a.metrics.free+'</div><div class="stat-label">Enviados FREE</div></div>'
      +   '<div class="stat"><div class="stat-kpi">'+(a.metrics.ev_avg ?? '—')+'</div><div class="stat-label">EV promedio (%)</div></div>'
      + '</div>'
      + '<div class="grid2">'
      +   '<div class="box"><h3>Niveles VIP / FREE</h3><div class="meters">'+meters+'</div></div>'
      +   '<div class="box"><h3>Top ligas / países</h3><ul class="toplist">'+(topLigas || '<li class="muted">Sin datos</li>')+'</ul></div>'
      + '</div>'
      + '<div class="box card" style="margin-top:12px;"><h3>Distribución de EV</h3><div class="meters">'+(evBuckets || '')+'</div></div>'
      + '<h3>Últimos '+htmlEscape(String(a.limit))+' picks</h3>'
      + '<div class="table-wrap">'
      +   '<table class="picks">'
      +     '<thead><tr>'
      +       '<th>Liga</th><th>Selección</th><th>EV</th><th>Prob.</th><th>Nivel</th><th>Canal</th><th>Fecha</th>'
      +     '</tr></thead>'
      +     '<tbody>'+ (rows || '<tr><td colspan="7" class="muted">Sin registros</td></tr>') +'</tbody>'
      +   '</table>'
      + '</div>'
      + '</div>';
  }

  // Telemetría de ciclos (si existe)
  let teleSection = '';
  if (tele && tele.ok && Array.isArray(tele.rows) && tele.rows.length) {
    const rows = tele.rows.map(r=>{
      const at = r.created_at || r.ts || r.timestamp || '—';
      const s  = (k)=> (r[k] ?? '—');
      return ''
        + '<tr>'
        +   '<td class="muted">'+at+'</td>'
        +   '<td>'+s('recibidos')+'</td><td>'+s('enVentana')+'</td><td>'+s('candidatos')+'</td>'
        +   '<td>'+s('procesados')+'</td><td>'+s('descartados_ev')+'</td>'
        +   '<td>'+s('enviados_vip')+'</td><td>'+s('enviados_free')+'</td>'
        +   '<td>'+s('guardados_ok')+'</td><td>'+s('guardados_fail')+'</td>'
        +   '<td>'+s('oai_calls')+'</td>'
        + '</tr>';
    }).join('');
    teleSection =
      '<div class="card">'
      + '<h2 style="margin-top:0">Telemetría de ciclos (últimos '+tele.limit+')</h2>'
      + '<div class="table-wrap"><table><thead><tr>'
      + '<th>Fecha</th><th>Recibidos</th><th>En ventana</th><th>Candidatos</th><th>Procesados</th><th>Desc. EV</th>'
      + '<th>VIP</th><th>FREE</th><th>Guardados OK</th><th>Guardados FAIL</th><th>OAI calls</th>'
      + '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  // Errores recientes (si existe)
  let errSection = '';
  if (errs && errs.ok && Array.isArray(errs.rows) && errs.rows.length) {
    const rows = errs.rows.map(r=>{
      const at = r.created_at || r.ts || r.timestamp || '—';
      const fn = r.funcion || r.function || r.fn || '—';
      const msg = (r.mensaje || r.message || '').toString().slice(0,240);
      return '<tr><td class="muted">'+at+'</td><td>'+fn+'</td><td><code class="code">'+msg+'</code></td></tr>';
    }).join('');
    errSection =
      '<div class="card">'
      + '<h2 style="margin-top:0">Errores recientes</h2>'
      + '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Función</th><th>Mensaje</th></tr></thead>'
      + '<tbody>'+rows+'</tbody></table></div></div>';
  }

  return `<!doctype html><meta charset="utf-8">
<title>PunterX — Diagnóstico</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:${bg}; --card:${card}; --border:${border}; --text:${text}; --muted:${muted}; --accent:${statusColor}; }
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font:14px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto,Inter,Arial,sans-serif;margin:0}
  .wrap{max-width:1120px;margin:0 auto;padding:24px}
  .header{display:flex;gap:16px;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap}
  .badge{display:inline-flex;align-items:center;gap:8px;background:color-mix(in srgb,var(--accent),#000 80%);color:#fff;border:1px solid var(--accent);padding:6px 10px;border-radius:999px;font-weight:600}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px}
  .grid{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .muted{color:var(--muted)}
  .chips{display:flex;gap:8px;flex-wrap:wrap}
  .chip{border:1px solid var(--border);background:#0b0f15;color:var(--muted);padding:4px 8px;border-radius:8px}
  .checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .check-card{background:#0c1118;border:1px solid #1a2537;border-radius:12px;padding:12px}
  .check-title{font-weight:700;margin-bottom:8px}
  .check-row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}
  .table-wrap{overflow:auto}
  table{width:100%;border-collapse:collapse}
  th,td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left;font-size:13px;vertical-align:top}
  code.code, pre.code{background:#0a0d13;border:1px solid #192233;border-radius:8px;padding:6px 8px;color:#c7e1ff;display:inline-block;max-width:100%;overflow:auto}
  .footer{margin-top:16px;color:var(--muted);font-size:12px}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 6px}
  .stat{background:#0c1118;border:1px solid #1a2537;border-radius:10px;padding:10px}
  .stat-kpi{font-size:22px;font-weight:800}
  .stat-label{color:var(--muted);font-size:12px}
  .meters{display:flex;flex-direction:column;gap:8px}
  .meter{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:center}
  .meter .bar{background:#0a0d13;border:1px solid #192233;border-radius:999px;height:10px;overflow:hidden}
  .meter .bar i{display:block;height:100%;background:linear-gradient(90deg,#5eead4,#60a5fa)}
  .toplist{margin:0;padding:0;list-style:none}
  .toplist li{display:flex;justify-content:space-between;border-bottom:1px dashed #182235;padding:6px 0}
  .pill{display:inline-block;border:1px solid #1a2537;background:#0c1118;border-radius:999px;padding:3px 8px}
  @media (max-width: 900px){ .grid{grid-template-columns:1fr} .grid2{grid-template-columns:1fr} .stats{grid-template-columns:repeat(2,1fr)} }
</style>
<div class="wrap">
  <div class="header">
    <h1 style="margin:0;font-size:20px">PunterX — Diagnóstico <span class="badge">${ok ? 'UP' : 'DEGRADED'}</span></h1>
    <div class="chips">
      <div class="chip">Build: ${htmlEscape(payload.build || '')}</div>
      <div class="chip">TZ: ${htmlEscape(payload.tz)}</div>
      <div class="chip">Node: ${htmlEscape(payload.node)}</div>
      <div class="chip">Generado: ${htmlEscape(payload.generated_at)}</div>
      <div class="chip"><a href="?json=1">JSON</a> · <a href="?ping=1">PING</a> · <a href="?deep=1">DEEP</a> · <a href="?deep=1&metrics=1">METRICS+</a></div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2 style="margin-top:0">Checks</h2>
      <div class="checks">${rowsChecks}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Entorno</h2>
      <table><tbody>${rowsEnv}</tbody></table>
    </div>
  </div>

  ${picksSection || ''}

  ${teleSection || ''}

  ${errSection || ''}

  <div class="footer">
    <div>© ${new Date().getFullYear()} PunterX · Estado global: <b style="color:var(--accent)">${ok ? 'UP' : 'DEGRADED'}</b></div>
  </div>
</div>`;
}

// ============ ORQUESTACIÓN ============
async function runChecks() {
  const [sb, oai, odds, foot, tg] = await Promise.all([
    checkSupabase(),
    checkOpenAI(),
    checkOddsAPI(),
    checkAPIFootball(),
    checkTelegram()
  ]);
  return buildPayload({ supabase: sb, openai: oai, oddsapi: odds, apifootball: foot, telegram: tg });
}

async function runDeepActivity({ limit = 30, hours = 24 } = {}) {
  return await fetchPicksSnapshot({ limit, hours });
}
async function runTelemetryAndErrors({ tele_limit = 20, err_limit = 10 } = {}) {
  const [tele, errs] = await Promise.all([
    fetchTelemetriaCiclos({ limit: tele_limit }),
    fetchErrores({ limit: err_limit })
  ]);
  return { tele, errs };
}

module.exports = {
  runChecks,
  runDeepActivity,
  runTelemetryAndErrors,
  renderHTML
};
