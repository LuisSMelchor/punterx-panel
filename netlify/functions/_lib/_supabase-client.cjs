// netlify/functions/_supabase-client.cjs
'use strict';

// Importación dinámica (ESM) y lazy init para evitar fallos pre-handler
let __sbCreateClient = null;
async function __ensureSupabaseCtor() {
  if (!__sbCreateClient) {
    const m = await import('@supabase/supabase-js'); // ESM → import dinámico
    __sbCreateClient = m.createClient || (m.default && m.default.createClient);
    if (!__sbCreateClient) {
      throw new Error('No se encontró createClient en @supabase/supabase-js');
    }
  }
  return __sbCreateClient;
}

let __sb = null;

/**
 * Obtiene (o inicializa) el cliente de Supabase.
 * No validamos ENV aquí para evitar romper en top-level;
 * el handler ya llama a assertEnv().
 */
async function getSupabase() {
  if (!__sb) {
    const createClient = await __ensureSupabaseCtor();
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    __sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
      global: { headers: { 'x-px-runtime': 'netlify-fn' } },
    });
  }
  return __sb;
}

// Alias usado por el handler
async function ensureSupabase() {
  return await getSupabase();
}

module.exports = {
  getSupabase,
  ensureSupabase,
};
