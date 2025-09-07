'use strict';


// [AF_SENTINEL_DBG_V1]
const __AF_DBG__ = !!process.env.AF_DEBUG;
const dlog = (...xs)=>{ if (__AF_DBG__) dlog('[AF_DEBUG]', ...xs); };
async function savePickToSupabase(row = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY; // anon/service, según tu despliegue
  if (!url || !key) {
    if (Number(process.env.DEBUG_TRACE)) {
      dlog('[STORE] faltan SUPABASE_URL/SUPABASE_KEY, skip');
    }
    return { ok: false, reason: 'missing-env' };
  }

  // Ajusta a tu tabla real: picks_historicos
  const table = process.env.SUPABASE_TABLE || 'picks_historicos';
  try {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!res.ok) {
      return { ok: false, status: res.status, statusText: res.statusText };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = { savePickToSupabase };
