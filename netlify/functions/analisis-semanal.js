// netlify/functions/analisis-semanal.js
// Resumen semanal + Telegram, con instrumentación mínima (functions_status + function_runs)

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

/** ====== Config / ENV ====== */
const FN_NAME = 'analisis-semanal';
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  TELEGRAM_CHANNEL_ID,
  TELEGRAM_BOT_TOKEN,
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** ====== Helpers de instrumentación (Supabase) ====== */
function nowIso() { return new Date().toISOString(); }

async function upsertFunctionStatus({ enabled = true, schedule = 'cron', env_ok = true, note = '' } = {}) {
  try {
    await supabase.from('functions_status').upsert({
      name: FN_NAME,
      enabled,
      schedule,
      env_ok,
      last_heartbeat: nowIso(),
      note: String(note || ''),
      updated_at: nowIso(),
    });
  } catch (e) {
    // silencioso: no romper ejecución por telemetría
    console.warn('[diag]', FN_NAME, 'upsertFunctionStatus err:', e?.message || e);
  }
}

function genRunId() {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${FN_NAME}-${Date.now()}-${rnd}`;
}

async function beginRun(run) {
  try {
    await supabase.from('function_runs').insert({
      run_id: run.run_id,
      function_name: FN_NAME,
      start_ts: nowIso(),
      status: 'running',
      meta: { env_ok: !!run.env_ok }
    });
  } catch (e) {
    console.warn('[diag]', FN_NAME, 'beginRun err:', e?.message || e);
  }
}

async function endRun(run_id, { status = 'ok', summary = {}, error = null } = {}) {
  try {
    await supabase.from('function_runs')
      .update({
        end_ts: nowIso(),
        status,
        summary,
        error: error ? String(error) : null,
      })
      .eq('run_id', run_id);
  } catch (e) {
    console.warn('[diag]', FN_NAME, 'endRun err:', e?.message || e);
  }
}

/** ====== Lógica existente ====== */
async function obtenerUltimos100Picks() {
  const { data, error } = await supabase
    .from('memoria_ia')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(100);

  if (error) throw new Error('Error al consultar picks: ' + error.message);
  return data;
}

function calcularEstadisticas(picks) {
  const total = picks.length;
  const porNivel = {};
  const porLiga = {};
  let ganados = 0;

  picks.forEach(pick => {
    const nivel = pick.nivel || 'Sin nivel';
    porNivel[nivel] = (porNivel[nivel] || 0) + 1;

    const liga = pick.liga || 'Desconocida';
    porLiga[liga] = (porLiga[liga] || 0) + 1;

    if (pick.acierto === true) ganados++;
  });

  const porcentaje = total > 0 ? ((ganados / total) * 100).toFixed(1) : '0.0';
  return { total, ganados, porcentaje, porNivel, porLiga };
}

function formatearMensaje({ total, ganados, porcentaje, porNivel, porLiga }) {
  const topLigas = Object.entries(porLiga)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([liga, cantidad]) => `- ${liga}: ${cantidad} picks`)
    .join('\n');

  const niveles = Object.entries(porNivel)
    .map(([nivel, cantidad]) => `- ${nivel}: ${cantidad}`)
    .join('\n');

  return `
📊 *Resumen semanal de rendimiento*

✅ Picks ganados: *${ganados}* de *${total}*
📈 Porcentaje de acierto: *${porcentaje}%*

🎯 Picks por nivel:
${niveles}

🌍 Ligas más frecuentes:
${topLigas}

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.

⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable.
`.trim();
}

async function enviarMensaje(mensaje) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHANNEL_ID,
    text: mensaje,
    parse_mode: 'Markdown'
  };

  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error('Error al enviar mensaje: ' + errorData);
  }
}

/** ====== Handler (con instrumentación) ====== */
exports.handler = async () => {
  const run_id = genRunId();
  const env_ok = !!(SUPABASE_URL && SUPABASE_KEY && TELEGRAM_CHANNEL_ID && TELEGRAM_BOT_TOKEN);

  // marcar estado y comenzar corrida
  await upsertFunctionStatus({ enabled: true, schedule: 'cron', env_ok });
  await beginRun({ run_id, env_ok });

  if (!env_ok) {
    await endRun(run_id, { status: 'error', error: 'ENV incompleto' });
    return {
      statusCode: 500,
      body: 'Error: variables de entorno incompletas'
    };
  }

  try {
    const picks = await obtenerUltimos100Picks();
    const estadisticas = calcularEstadisticas(picks);
    const mensaje = formatearMensaje(estadisticas);
    await enviarMensaje(mensaje);

    await endRun(run_id, { status: 'ok', summary: { total: estadisticas.total, ganados: estadisticas.ganados, porcentaje: estadisticas.porcentaje } });
    return {
      statusCode: 200,
      body: 'Resumen semanal enviado con éxito.'
    };
  } catch (error) {
    await endRun(run_id, { status: 'error', error: error?.message || String(error) });
    return {
      statusCode: 500,
      body: 'Error en resumen semanal: ' + error.message
    };
  }
};
