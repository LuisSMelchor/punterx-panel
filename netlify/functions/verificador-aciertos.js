// netlify/functions/verificador-aciertos.js
// Verifica resultados y actualiza estado de picks (esqueleto seguro).
// POST/GET /.netlify/functions/verificador-aciertos
// Nota: ajusta la lógica de verificación según tu fuente de resultados.

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

const RESULTADOS_VALIDOS = new Set(['ganado', 'perdido', 'nulo', 'pendiente']);

function asJSON(event) { return !!((event.queryStringParameters || {}).json); }

async function getClient() {
  try { return await getSupabase(); }
  catch (e) { console.error('[VERIFY] Supabase shim error:', e?.message || e); return null; }
}

async function listarPendientes(limit = 100) {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Supabase no disponible' };

  const { data, error } = await supabase
    .from('picks_historicos')
    .select('id, evento_id, timestamp, apuesta, liga, pais, resultado')
    .eq('resultado', 'pendiente')
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data || [] };
}

async function actualizarResultado(id, resultado, meta = {}) {
  if (!RESULTADOS_VALIDOS.has(resultado)) {
    return { ok: false, error: `Resultado inválido: ${resultado}` };
  }
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Supabase no disponible' };

  const { error } = await supabase
    .from('picks_historicos')
    .update({ resultado, meta_verificacion: meta, verificado_en: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Ejemplo de verificación “mock”: marca pendientes antiguos como “nulo” pasado cierto tiempo.
// Sustituye por tu integración real (API de resultados, scraping, etc.).
async function runVerificacion() {
  const { ok, data, error } = await listarPendientes(200);
  if (!ok) return { ok: false, error };

  const ahora = Date.now();
  const cambios = [];

  for (const p of data) {
    try {
      const edadMin = 6 * 60 * 60 * 1000; // 6 horas
      const ts = new Date(p.timestamp).getTime();
      if (ahora - ts > edadMin) {
        const up = await actualizarResultado(p.id, 'nulo', { razon: 'timeout_auto' });
        if (up.ok) cambios.push({ id: p.id, de: p.resultado, a: 'nulo' });
      }
    } catch (e) {
      // continuar con el siguiente
    }
  }
  return { ok: true, revisados: data.length, actualizados: cambios.length, cambios };
}

exports.handler = async (event) => {
  try {
    // Si POST con body { id, resultado }, actualiza uno directo
    if (event.httpMethod === 'POST' && event.body) {
      try {
        const payload = JSON.parse(event.body);
        const { id, resultado, meta } = payload || {};
        const res = await actualizarResultado(id, resultado, meta);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res) };
      } catch (e) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: e?.message || String(e) }) };
      }
    }

    // Ejecución general (GET)
    const out = await runVerificacion();
    if (asJSON(event)) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: out.ok
        ? `Verificación OK — revisados: ${out.revisados}, actualizados: ${out.actualizados}`
        : `Error: ${out.error}`
    };
  } catch (e) {
    const msg = e?.message || String(e);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok:false, error: msg }) };
  }
};
