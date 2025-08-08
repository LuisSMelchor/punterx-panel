const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

exports.handler = async function () {
  try {
    const today = new Date().toISOString().split("T")[0];

    const { data: picks, error } = await supabase
      .from("picks_historicos")
      .select("*")
      .gte("timestamp", `${today}T00:00:00Z`);

    if (error) throw error;

    const totalPicks = picks.length;
    const evPromedio =
      totalPicks > 0
        ? (
            picks.reduce((sum, p) => sum + (parseFloat(p.ev) || 0), 0) /
            totalPicks
          ).toFixed(1)
        : 0;

    const niveles = {
      "🎯 Élite Mundial": 0,
      "🥈 Avanzado": 0,
      "🥉 Competitivo": 0,
      "📄 Informativo": 0,
      "🟣 Ultra Elite": 0,
    };

    picks.forEach((p) => {
      if (niveles[p.nivel] !== undefined) niveles[p.nivel]++;
    });

    const ultimoPick = picks.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    )[0];

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Diagnóstico PunterX</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #0b1120;
      color: #f1f5f9;
      padding: 40px;
      line-height: 1.6;
    }
    h1 {
      color: #22c55e;
    }
    h2 {
      margin-top: 40px;
      color: #60a5fa;
    }
    .card {
      background: #1e293b;
      padding: 20px;
      border-radius: 12px;
      margin-top: 20px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
    }
    .metric {
      font-size: 1.2em;
      margin: 10px 0;
    }
    .highlight {
      color: #22c55e;
      font-weight: bold;
    }
    .level {
      margin-left: 15px;
    }
  </style>
</head>
<body>
  <h1>📊 Diagnóstico PunterX - ${new Date().toLocaleDateString()}</h1>

  <div class="card">
    <h2>🕵️ Último Pick Generado</h2>
    ${
      ultimoPick
        ? `
      <div class="metric">Liga: <span class="highlight">${ultimoPick.liga}</span></div>
      <div class="metric">Partido: <span class="highlight">${ultimoPick.equipos}</span></div>
      <div class="metric">Apuesta sugerida: <span class="highlight">${ultimoPick.apuesta}</span></div>
      <div class="metric">EV: <span class="highlight">+${ultimoPick.ev}%</span></div>
      <div class="metric">Nivel: <span class="highlight">${ultimoPick.nivel}</span></div>
      `
        : "<div>No hay picks generados hoy aún.</div>"
    }
  </div>

  <div class="card">
    <h2>📈 Métricas rápidas del día</h2>
    <div class="metric">Total de picks: <span class="highlight">${totalPicks}</span></div>
    <div class="metric">EV promedio: <span class="highlight">${evPromedio}%</span></div>
    <div class="metric">Niveles detectados:</div>
    ${Object.entries(niveles)
      .map(
        ([nivel, count]) =>
          `<div class="metric level">${nivel}: <span class="highlight">${count}</span></div>`
      )
      .join("")}
  </div>

</body>
</html>
    `;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
      },
      body: html,
    };
  } catch (err) {
    console.error("Error:", err.message);
    return {
      statusCode: 500,
      body: "Error interno en diagnóstico.",
    };
  }
};
