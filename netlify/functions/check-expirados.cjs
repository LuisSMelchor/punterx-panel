const { supabase } = require('./_supabase-client.cjs');
const { expulsarUsuarioVIP } = require('./send.js');

exports.handler = async () => {
  const { data: expirados, error } = await supabase
    .from('usuarios')
    .select('id_telegram')
    .eq('estado', 'trial')
    .lt('fecha_expira', new Date().toISOString());

  if (error) {
    console.error('Error Supabase', error);
    return { statusCode: 500, body: 'Error' };
  }

  for (const u of expirados) {
    await supabase.from('usuarios')
      .update({ estado: 'expired' })
      .eq('id_telegram', u.id_telegram);

    await expulsarUsuarioVIP(u.id_telegram);
  }

  return { statusCode: 200, body: 'Expirados revisados' };
};
