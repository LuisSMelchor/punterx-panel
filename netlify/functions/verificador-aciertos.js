// verificador-aciertos.js - Verifica resultados y marca picks acertados o no

const fetch = globalThis.fetch;

exports.handler = async function () {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

  // 1. Obtener los picks recientes sin resultado registrado
  const picksRes = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos?select=*&resultado_real=is.null&hora_local=lt.${horaActualCDMX()}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });

  const picks = await picksRes.json();
  if (!picks.length) {
    console.log("✅ No hay picks pendientes de verificar.");
    return { statusCode: 200, body: "Sin tareas pendientes" };
  }

  for (const pick of picks) {
    const nombreLocal = pick.equipo_local;
    const nombreVisita = pick.equipo_visitante;
    const fecha = pick.hora_local.split(" ")[0]; // formato YYYY-MM-DD

    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${fecha}`, {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    });

    const data = await res.json();
    const partidos = data.response;

    const match = partidos.find(p =>
      p.teams.home.name.toLowerCase().includes(nombreLocal.toLowerCase()) &&
      p.teams.away.name.toLowerCase().includes(nombreVisita.toLowerCase())
    );

    if (!match) {
      console.warn(`❌ Partido no encontrado en API para: ${nombreLocal} vs ${nombreVisita}`);
      continue;
    }

    const golesLocal = match.goals.home;
    const golesVisita = match.goals.away;
    const resultado = `${golesLocal} - ${golesVisita}`;

    const mensaje = pick.mensaje.toLowerCase();
    let acertado = false;

    if (mensaje.includes("local") && golesLocal > golesVisita) acertado = true;
    else if (mensaje.includes("visitante") && golesVisita > golesLocal) acertado = true;
    else if (mensaje.includes("empate") && golesLocal === golesVisita) acertado = true;

    // 3. Actualizar Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos?id=eq.${pick.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        resultado_real: resultado,
        pick_acertado: acertado
      })
    });

    console.log(`📊 Verificado: ${nombreLocal} vs ${nombreVisita} → ${resultado} → ✅ Acertado: ${acertado}`);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};

function horaActualCDMX() {
  const now = new Date();
  const utc = new Date(now.toUTCString());
  const cdmx = new Date(utc.getTime() - (5 * 60 * 60 * 1000));
  return cdmx.toISOString().split("T")[0];
}
