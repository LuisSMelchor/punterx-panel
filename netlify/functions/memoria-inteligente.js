// netlify/functions/memoria-inteligente.js
// Admin simple de memoria IA en Supabase (GET lista / POST upsert / DELETE borrar).
// Usa el shim de Supabase singleton para evitar redeclaraciones.
//
// Endpoints:
//   GET    /.netlify/functions/memoria-inteligente?json=1&limit=50
//   POST   /.netlify/functions/memoria-inteligente           (body: { clave, valor, meta? })
//   DELETE /.netlify/functions/memoria-inteligente?id=123    (o body: { id })
//
// Requisitos de tabla (por defecto: memoria_ia; configurable con MEMORIA_TABLE):
//   id: bigint (PK) | clave: text | valor: jsonb | meta: jsonb | updated_at: timestamptz

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

const TABLE = process.env.MEMORIA_TABLE || 'memoria_ia';
const DEFAULT_LIMIT = 50;

function asJSON(event) { return !!((event.queryStringParameters || {}).json); }
function getLimit(event) {
  const raw = (event.queryStringParameters || {}).limit;
  const n = Math.max(1, Math.min(500, Number(raw) || DEFAULT_LIMIT));
  return n;
}
function ok(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function bad(msg) {
  return ok({ ok: false, error: msg });
}

async function getClient() {
  try { return await getSupabase(); }
  catch (e) {
    console.error('[MEMORIA] Supabase shim error:', e?.message || e);
    return null;
  }
}

async function listItems(limit) {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Supabase no disponible' };

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, clave, valor, meta, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data || [] };
}

async function upsertItem(payload) {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Supabase no disponible' };

  const { clave, valor, meta } = payload || {};
  if (!clave) return { ok: false, error: 'Falta "clave"' };

  const row = {
    clave: String(clave),
    valor: (valor === undefined ? null : valor),
    meta: meta || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(TABLE)
    .upsert([row])
    .select('id, clave, updated_at')
    .limit(1);

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data && data[0] ? data[0] : null };
}

async function deleteItem(event) {
  const supabase = await getClient();
  if (!supabase) return { ok: false, error: 'Supabase no disponible' };

  let id = (event.queryStringParameters || {}).id;
  if (!id && event.body) {
    try { id = (JSON.parse(event.body) || {}).id; } catch {}
  }
  if (!id) return { ok: false, error: 'Falta "id" para borrar' };

  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, deleted: id };
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod || 'GET';

    if (method === 'GET') {
      const res = await listItems(getLimit(event));
      if (asJSON(event)) return ok(res);
      // Vista rápida en HTML
      const rows = (res.data || []).map(r => `
        <tr>
          <td>${r.id}</td>
          <td>${String(r.clave || '')}</td>
          <td><pre>${JSON.stringify(r.valor, null, 2)}</pre></td>
          <td><pre>${JSON.stringify(r.meta || {}, null, 2)}</pre></td>
          <td>${r.updated_at}</td>
        </tr>`).join('');
      const html = `<!doctype html><meta charset="utf-8">
<title>PunterX — Memoria IA</title>
<style>
  body{background:#0b0b10;color:#e5e7eb;font:14px/1.5 system-ui,Segoe UI,Roboto}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2330;text-align:left;vertical-align:top}
  pre{margin:0;white-space:pre-wrap}
  .card{background:#11131a;border:1px solid #1f2330;border-radius:12px;padding:14px;margin:14px}
</style>
<div class="card">
  <h1>Memoria IA (${TABLE})</h1>
  <p>Total mostrados: ${res.ok ? res.data.length : 0}</p>
  ${res.ok ? '' : `<p>Error: ${res.error}</p>`}
</div>
<div class="card">
  <table>
    <tr><th>id</th><th>clave</th><th>valor</th><th>meta</th><th>updated_at</th></tr>
    ${rows || '<tr><td colspan="5">Sin datos</td></tr>'}
  </table>
</div>`;
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html };
    }

    if (method === 'POST') {
      const payload = event.body ? JSON.parse(event.body) : {};
      const res = await upsertItem(payload);
      return ok(res);
    }

    if (method === 'DELETE') {
      const res = await deleteItem(event);
      return ok(res);
    }

    return ok({ ok: false, error: `Método no soportado: ${method}` });
  } catch (e) {
    return ok({ ok: false, error: e?.message || String(e) });
  }
};
