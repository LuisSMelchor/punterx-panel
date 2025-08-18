// netlify/functions/diagnostico-total.js
'use strict';

const { fmtSecs } = require('./_logger.cjs');

function html(layout) {
  return {
    ok: (body) => ({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body
    }),
    json: (obj) => ({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    }),
    err: (e) => ({
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: (e && e.stack) ? e.stack : String(e)
    })
  };
}

// Intenta obtener el cliente de Supabase tratando distintos exports
function getSupabase() {
  try {
    const mod = require('./_supabase-client.cjs');
    if (!mod) return null;
    if (mod.supabase) return mod.supabase;
    if (mod.client) return mod.client;
    if (typeof mod.getClient === 'function') return mod.getClient();
  } catch (e) {
    // ignore
  }
  return null;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function badge(v, good=true) {
  const color = good ? '#0ea5e9' : '#ef4444';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${color};color:white;font-weight:600;font-size:12px;">${esc(v)}</span>`;
}

function card({title, body, foot}) {
  return `<div class="card">
    <div class="card-title">${esc(title)}</div>
    <div class="card-body">${body}</div>
    ${foot ? `<div class="card-foot">${foot}</div>` : ''}
  </div>`;
}

function table(rows, headers) {
  const th = headers.map(h => `<th>${esc(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

function layout({title, sections}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg:#0b1220; --fg:#e5e7eb; --muted:#94a3b8; --card:#111827; --accent:#22d3ee; --good:#22c55e; --bad:#ef4444; --warn:#f59e0b;
  }
  *{box-sizing:border-box}
  body{margin:0;background:linear-gradient(180deg,#0b1220 0%,#0b1220 50%,#0f172a 100%);color:var(--fg);font:14px/1.5 system-ui,Segoe UI,Roboto,Helvetica,Arial;}
  header{padding:16px 20px;border-bottom:1px solid #1f2937;background:linear-gradient(90deg,#0ea5e9, #22d3ee);}
  header h1{margin:0;font-size:20px;color:#0b1220}
  header .sub{color:#0b1220aa}
  .wrap{max-width:1100px;margin:0 auto;padding:20px;}
  .grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));}
  .card{background:var(--card);border:1px solid #1f2937;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,.25);padding:16px}
  .card-title{font-weight:700;color:#e2e8f0;margin-bottom:8px;}
  .card-body{color:#cbd5e1}
  .card-foot{margin-top:8px;color:#94a3b8;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{border-bottom:1px solid #1f2937;padding:8px;text-align:left}
  th{color:#e2e8f0}
  .muted{color:var(--muted)}
  .kpi{font-size:24px;font-weight:800}
  .kpi small{font-size:12px;color:var(--muted)}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  .pill{padding:2px 8px;border-radius:999px;background:#1f2937;border:1px solid #27324a}
  .ok{color:#86efac}.warn{color:#fde047}.bad{color:#fca5a5}
  footer{padding:24px 20px;color:#64748b;text-align:center}
  a{color:#7dd3fc;text-decoration:none}
</style>
</head>
<body>
<header>
  <h1>PunterX · Diagnóstico</h1>
  <div class="sub">Estado en tiempo real · ${esc(new Date().toLocaleString('es-MX',{hour12:false}))}</div>
</header>
<div class="wrap">
  ${sections.join('\n')}
</div>
<footer>🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.</footer>
</body>
</html>`;
}

async function loadData() {
  const supabase = getSupabase();
  if (!supabase) return { ok:false, err:'Supabase client no disponible' };

  const res = { ok:true, picks:[], ejecs:[], locks:[], estado:null };

  try {
    const { data: picks } = await supabase
      .from('picks_historicos')
      .select('evento, liga, equipos, ev, probabilidad, tipo_pick, nivel, timestamp')
      .order('timestamp', { ascending: false })
      .limit(10);
    res.picks = picks || [];
  } catch (e) { res.picks = []; res.picks_err = String(e); }

  try {
    const { data: ejecs } = await supabase
      .from('diagnostico_ejecuciones')
      .select('created_at, recibidos, enVentana, candidatos, procesados, descartados_ev, enviados_vip, enviados_free, guardados_ok, principal, fallback, af_hits, af_fails')
      .order('created_at', { ascending: false })
      .limit(6);
    res.ejecs = ejecs || [];
  } catch (e) { res.ejecs = []; res.ejecs_err = String(e); }

  try {
    const { data: locks } = await supabase
      .from('px_locks')
      .select('k, expires_at, created_at')
      .order('created_at', { ascending: false })
      .limit(5);
    res.locks = locks || [];
  } catch (e) { res.locks = []; res.locks_err = String(e); }

  try {
    const { data: estado } = await supabase
      .from('diagnostico_estado')
      .select('oddsapi_ok, af_ok, openai_ok, last_cycle_ms')
      .limit(1)
      .maybeSingle();
    res.estado = estado || null;
  } catch (e) { res.estado = null; res.estado_err = String(e); }

  return res;
}

function render(data) {
  const secs = [];

  // KPIs y estado de APIs
  const st = data.estado || {};
  const apis = [
    ['OddsAPI', st.oddsapi_ok ? badge('OK') : badge('FALLA', false)],
    ['API-FOOTBALL', st.af_ok ? badge('OK') : badge('FALLA', false)],
    ['OpenAI', st.openai_ok ? badge('OK') : badge('FALLA', false)],
  ];
  const kpiRows = [
    ['Último ciclo (duración)', st.last_cycle_ms ? fmtSecs(st.last_cycle_ms) : '<span class="muted">—</span>'],
    ['Locks activos', (data.locks && data.locks.length) ? String(data.locks.length) : '0']
  ];

  secs.push(`<div class="grid">
    ${card({ title:'APIs', body: table(apis, ['Servicio','Estado']) })}
    ${card({ title:'Ciclo', body: table(kpiRows, ['Métrica','Valor']) })}
  </div>`);

  // Últimas ejecuciones
  const ejecRows = (data.ejecs || []).map(e => ([
    esc(new Date(e.created_at).toLocaleString('es-MX',{hour12:false})),
    String(e.recibidos||0),
    String(e.enVentana||0),
    String(e.candidatos||0),
    String(e.procesados||0),
    String(e.descartados_ev||0),
    String(e.enviados_vip||0),
    String(e.enviados_free||0),
    String(e.guardados_ok||0),
    String(e.principal||0)+'/'+String(e.fallback||0),
    String(e.af_hits||0)+'/'+String(e.af_fails||0),
  ]));
  secs.push(card({
    title: 'Últimas ejecuciones',
    body: table(ejecRows, ['Fecha','Recibidos','En ventana','Candidatos','Procesados','Desc. EV','VIP','FREE','Guardados','Ventanas P/F','AF hits/fails'])
  }));

  // Picks recientes
  const pickRows = (data.picks || []).map(p => ([
    esc(new Date(p.timestamp).toLocaleString('es-MX',{hour12:false})),
    esc(p.liga || '—'),
    esc(p.equipos || '—'),
    (p.tipo_pick || '—'),
    (p.nivel || '—'),
    (typeof p.ev === 'number' ? (Math.round(p.ev*1000)/10)+'%' : '—'),
    (typeof p.probabilidad === 'number' ? (Math.round(p.probabilidad*1000)/10)+'%' : '—')
  ]));
  secs.push(card({
    title:'Picks recientes',
    body: pickRows.length ? table(pickRows, ['Fecha','Liga','Partido','Tipo','Nivel','EV','P(IA)']) : '<span class="muted">No hay registros recientes.</span>',
    foot:'* EV calculado contra probabilidad implícita de la cuota elegida'
  }));

  // Locks
  const lockRows = (data.locks || []).map(l => ([
    esc(l.k || '—'),
    esc(l.expires_at ? new Date(l.expires_at).toLocaleString('es-MX',{hour12:false}) : '—'),
    esc(l.created_at ? new Date(l.created_at).toLocaleString('es-MX',{hour12:false}) : '—'),
  ]));
  secs.push(card({
    title:'Locks recientes',
    body: lockRows.length ? table(lockRows, ['Clave','Expira','Creado']) : '<span class="muted">Sin locks recientes.</span>'
  }));

  // ENV breve (no sensibles)
  const envRows = [
    ['Ventana principal', `${process.env.WINDOW_MAIN_MIN||'45'}–${process.env.WINDOW_MAIN_MAX||'55'} min`],
    ['Fallback', `${process.env.WINDOW_FALLBACK_MIN||'35'}–${process.env.WINDOW_FALLBACK_MAX||'70'} min`],
    ['STRICT_MATCH', String(process.env.STRICT_MATCH||'0')],
    ['ODDS_SPORT_KEY', esc(process.env.ODDS_SPORT_KEY||'soccer')],
    ['ODDS_REGIONS', esc(process.env.ODDS_REGIONS||'us,uk,eu,au')],
    ['LIVE_REGIONS', esc(process.env.LIVE_REGIONS||'(hereda ODDS_REGIONS)')],
    ['LOG_VERBOSE', String(process.env.LOG_VERBOSE||'0')],
  ];
  secs.push(card({ title:'Config activa (resumen)', body: table(envRows, ['Clave','Valor'])}));

  return layout({ title:'PunterX Diagnóstico', sections: secs });
}

exports.handler = async (event, context) => {
  const h = html();
  try {
    const jsonMode = (event && event.queryStringParameters && event.queryStringParameters.json) ? true : false;
    const t0 = Date.now();
    const data = await loadData();
    const elapsed = Date.now() - t0;

    if (jsonMode) {
      return h.json({ ok:true, elapsed_ms: elapsed, data });
    }
    return h.ok(render(data));
  } catch (e) {
    return html().err(e);
  }
};
