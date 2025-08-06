const fetch = require('node-fetch');

const { SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY } = process.env;

async function handler() {
  try {
    // 1. Consultar los últimos 100 picks
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos?order=timestamp.desc&limit=100`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    const picks = await res.json();

    if (!picks || picks.length === 0) throw new Error("No se encontraron picks");

    // 2. Procesar estadísticas básicas
    const total = picks.length;
    const ganados = picks.filter(p => p.tipo_pick?.toLowerCase().includes("ganado")).length;
    const perdidos = picks.filter(p => p.tipo_pick?.toLowerCase().includes("perdido")).length;
    const neutros = total - ganados - perdidos;
    const acierto = parseFloat(((ganados / total) * 100).toFixed(2));

    const ligas = contarFrecuencia(picks.map(p => p.liga));
    const niveles = contarFrecuencia(picks.map(p => p.nivel));
    const apuestas = contarFrecuencia(picks.map(p => p.apuesta));

    // 3. Preparar prompt para GPT-4
    const prompt = `
Analiza el siguiente rendimiento de un sistema de predicción de apuestas deportivas usando IA. Genera un resumen profesional breve y útil tipo newsletter (máx 300 palabras), incluyendo:

- Resultados generales (ganados, perdidos, acierto)
- Ligas y niveles destacados
- Apuestas más frecuentes
- Observaciones clave o patrones detectados

Estadísticas:
- Total de picks: ${total}
- Ganados: ${ganados}
- Perdidos: ${perdidos}
- Neutros: ${neutros}
- Porcentaje de acierto: ${acierto}%

Ligas destacadas: ${ligas.join(', ')}
Niveles destacados: ${niveles.join(', ')}
Apuestas populares: ${apuestas.join(', ')}
`;

    const resumenIA = await generarConOpenAI(prompt);

    // 4. Guardar en Supabase
    const guardar = await fetch(`${SUPABASE_URL}/rest/v1/analisis_semanal`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        resumen_ia: resumenIA,
        total_picks: total,
        picks_ganados: ganados,
        picks_perdidos: perdidos,
        picks_neutros: neutros,
        porcentaje_acierto: acierto,
        ligas_destacadas: ligas.join(', '),
        niveles_destacados: niveles.join(', '),
        apuestas_populares: apuestas.join(', '),
        observaciones: '' // Puede llenarse manualmente luego
      }]),
    });

    const resultado = await guardar.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ mensaje: "Análisis semanal guardado correctamente", resultado })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
}

// Funciones auxiliares
function contarFrecuencia(arr) {
  const conteo = {};
  arr.forEach(el => {
    if (!el) return;
    conteo[el] = (conteo[el] || 0) + 1;
  });
  return Object.entries(conteo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([item, cantidad]) => `${item} (${cantidad})`);
}

async function generarConOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  });

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "Sin resumen generado.";
}

module.exports = { handler };
