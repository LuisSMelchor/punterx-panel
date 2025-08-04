
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 🧠 Función que genera un resumen inteligente para IA
export async function generarResumenIA() {
  try {
    const { data, error } = await supabase
      .from('picks_historicos')
      .select('*')
      .order('fecha', { ascending: false })
      .limit(100);

    if (error || !data) {
      console.error('❌ Error obteniendo picks:', error || 'Sin datos');
      return 'No se encontraron datos recientes.';
    }

    let total = data.length;
    let evAlta = data.filter(p => p.valor_esperado >= 30).length;
    let evMedia = data.filter(p => p.valor_esperado >= 20 && p.valor_esperado < 30).length;
    let evBaja = data.filter(p => p.valor_esperado >= 15 && p.valor_esperado < 20).length;
    let ligas = {};
    let equipos = {};

    data.forEach(p => {
      ligas[p.liga] = (ligas[p.liga] || 0) + 1;
      const local = p.equipo_local;
      const visita = p.equipo_visitante;
      equipos[local] = (equipos[local] || 0) + 1;
      equipos[visita] = (equipos[visita] || 0) + 1;
    });

    const topLigas = Object.entries(ligas)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([liga, count]) => `${liga} (${count} picks)`);

    const topEquipos = Object.entries(equipos)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([equipo, count]) => `${equipo} (${count} apariciones)`);

    const resumen = `Últimos ${total} picks guardados:
✅ Picks con EV alto (30%+): ${evAlta}
🟡 Picks con EV medio (20%-29%): ${evMedia}
🟠 Picks con EV bajo (15%-19%): ${evBaja}
🏆 Ligas más analizadas: ${topLigas.join(', ')}
📌 Equipos más frecuentes: ${topEquipos.join(', ')}`;

    return resumen;

  } catch (err) {
    console.error('❌ Error generando resumen IA:', err);
    return 'Error procesando resumen de memoria.';
  }
}
