
const { createClient } = require('@supabase/supabase-js');
dayjs.locale('es');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  try {
    // Obtener total de picks
    const { count: totalPicks, error: errorPicks } = await supabase
      .from('picks_historicos')
      .select('*', { count: 'exact', head: true });

    if (errorPicks) throw errorPicks;

    // Obtener último pick
    const { data: ultimoPickData, error: errorUltimo } = await supabase
      .from('picks_historicos')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1);

    if (errorUltimo) throw errorUltimo;

    const ultimoPick = ultimoPickData?.[0]?.timestamp
      ? dayjs(ultimoPickData[0].timestamp).format('D [de] MMMM, HH:mm [(CDMX)]')
      : 'No disponible';

    // Obtener usuarios VIP
    const { count: vipActivos, error: errorVip } = await supabase
      .from('usuarios_vip')
      .select('*', { count: 'exact', head: true })
      .eq('estatus', 'activo');

    if (errorVip) throw errorVip;

    // Obtener usuarios en prueba
    const { count: pruebaActivos, error: errorPrueba } = await supabase
      .from('usuarios_vip')
      .select('*', { count: 'exact', head: true })
      .eq('estatus', 'prueba');

    if (errorPrueba) throw errorPrueba;

    // Simulaciones o placeholders
    const memoria = 'Operativa';
    const analisisIA = dayjs().format('D [de] MMMM HH:mm');

    const resultado = `📊 Estado del sistema: Activo
📅 Último pick enviado: ${ultimoPick}
📂 Total de picks guardados: ${totalPicks}
👥 Usuarios VIP actuales: ${vipActivos}
🧪 Usuarios en prueba gratuita: ${pruebaActivos}
🧠 Memoria inteligente: ${memoria}
📦 Último análisis de IA: ${analisisIA}`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: resultado,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: `❌ Error al generar el diagnóstico: ${err.message}`,
    };
  }
};
