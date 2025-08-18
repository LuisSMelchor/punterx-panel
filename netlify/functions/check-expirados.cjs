// netlify/functions/check-expirados.cjs
// Desactiva trials vencidos y, opcionalmente, revoca invitaciones si guardas el link.

const VERSION = 'check-expirados v1.0';

async function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE env missing');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

exports.handler = async () => {
  console.log(`[${VERSION}] start`);
  try {
    const supabase = await getSupabase();
    const nowIso = new Date().toISOString();

    // 1) Marcar expirados
    const { data, error } = await supabase
      .from('usuarios')
      .update({ estado: 'expired' })
      .lte('fecha_expira', nowIso)
      .eq('estado', 'trial')
      .select('id_telegram');

    if (error) {
      console.error('update expired error', error);
      return { statusCode: 200, body: 'error' };
    }

    console.log(`[${VERSION}] expirados=${data?.length || 0}`);
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    console.error(`[${VERSION}] fail`, e);
    return { statusCode: 200, body: 'error' };
  }
};
