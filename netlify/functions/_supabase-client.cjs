// netlify/functions/_supabase-client.cjs
// Singleton seguro para CJS+ESM y esbuild, sin redeclaraciones.
let _promise = null;

module.exports = async function getSupabase() {
  if (_promise) return _promise;

  // Cache global para contenedores “calientes”
  if (!globalThis.__PX_SUPA__) globalThis.__PX_SUPA__ = {};

  if (globalThis.__PX_SUPA__.client) {
    _promise = Promise.resolve(globalThis.__PX_SUPA__.client);
    return _promise;
  }

  const mod = await import('@supabase/supabase-js'); // ESM dinámico, recomendado
  const createClient = mod.createClient || (mod.default && mod.default.createClient);
  if (typeof createClient !== 'function') {
    throw new Error('No se encontró createClient en @supabase/supabase-js');
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY');

  const client = createClient(url, key);
  globalThis.__PX_SUPA__.client = client;
  _promise = Promise.resolve(client);
  return _promise;
};
