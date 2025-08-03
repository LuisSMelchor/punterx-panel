// autopick-vip.js FINAL PRO MAX - IA con todos los módulos activados

const fetch = globalThis.fetch;

exports.handler = async function () {
  const crypto = await import('node:crypto');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  const PANEL_ENDPOINT = process.env.PANEL_ENDPOINT;
  const AUTH_CODE = process.env.AUTH_CODE;
  const SECRET = process.env.PUNTERX_SECRET;

  const now = new Date();
  const nowUTC = new Date(now.toUTCString());
  const horaCDMX = new Date(nowUTC.getTime() - (5 * 60 * 60 * 1000));
  const fechaHoy = horaCDMX.toISOString().split('T')[0];
  const timestamp = Date.now();

  function calcularEV(prob, cuota) {
    return Math.round(((prob * cuota) - 1) * 100);
  }

  function clasificarNivel(ev) {
    if (ev >= 30) return "Élite Mundial";
    if (ev >= 20) return "Avanzado";
    if (ev >= 15) return "Competitivo";
    return null;
  }

  async function obtenerPartidos() {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${fechaHoy}`, {
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    });
    const data = await res.json();
    return data.response;
  }

  function filtrarPartidos(partidos) {
    const ahora = new Date();
    return partidos.filter(p => {
      const inicio = new Date(p.fixture.date);
      const minutos = (inicio - ahora) / 60000;
      return minutos > 44 && minutos < 56;
    });
  }

  async function obtenerExtras(fixtureId, homeId, awayId) {
    const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
    const [lineups, injuries, stats, h2h, fixtureDetail, homePlayers, awayPlayers, standings, topscorers, predictions] = await Promise.all([
      fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/injuries?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures/headtohead?h2h=${homeId}-${awayId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/players?team=${homeId}&season=2024`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/players?team=${awayId}&season=2024`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/standings?league=${fixtureId}&season=2024`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/players/topscorers?league=${fixtureId}&season=2024`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/predictions?fixture=${fixtureId}`, { headers }).then(r => r.json())
    ]);

    const referee = fixtureDetail.response?.[0]?.fixture?.referee || null;
    const weather = fixtureDetail.response?.[0]?.fixture?.weather || null;

    return {
      lineups: lineups.response,
      injuries: injuries.response,
      stats: stats.response,
      h2h: h2h.response,
      referee,
      weather,
      homePlayers: homePlayers.response,
      awayPlayers: awayPlayers.response,
      standings: standings.response,
      topscorers: topscorers.response,
      predictions: predictions.response
    };
  }

  async function obtenerCuotas(partido) {
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=us,eu,uk&markets=h2h&apiKey=${ODDS_API_KEY}`);
      const data = await res.json();
      const match = data.find(item =>
        item.home_team.toLowerCase().includes(partido.teams.home.name.toLowerCase()) &&
        item.away_team.toLowerCase().includes(partido.teams.away.name.toLowerCase())
      );
      if (!match || !match.bookmakers) return null;
      const mejoresCuotas = { home: 0, draw: 0, away: 0 };
      match.bookmakers.forEach(bm => {
        bm.markets[0].outcomes.forEach(outcome => {
          if (outcome.name === "Home" && outcome.price > mejoresCuotas.home) mejoresCuotas.home = outcome.price;
          if (outcome.name === "Draw" && outcome.price > mejoresCuotas.draw) mejoresCuotas.draw = outcome.price;
          if (outcome.name === "Away" && outcome.price > mejoresCuotas.away) mejoresCuotas.away = outcome.price;
        });
      });
      return mejoresCuotas;
    } catch (e) {
      console.error("Error obteniendo cuotas:", e.message);
      return null;
    }
  }

  async function generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, esGratis = false) {
    const prompt = `Eres un analista deportivo experto con acceso a datos de fútbol de todo el mundo. Analiza este partido con base en la siguiente información y genera un mensaje ${esGratis ? 'para el canal gratuito' : 'para el grupo VIP'}.

⚽ Equipos: ${partido.teams.home.name} vs ${partido.teams.away.name}  
🌍 Liga: ${partido.league.name} (${partido.league.country})  
📅 Fecha: ${fechaHoy} | 🕒 Hora: ${hora} CDMX  
💸 Cuotas: ${cuotas.home} vs ${cuotas.away}  
📈 EV: ${ev}%  
📊 Nivel: ${nivel || 'N/A'}  
🧑‍⚖️ Árbitro: ${extras.referee || 'Desconocido'}  
☁️ Clima: ${extras.weather?.temperature?.celsius || 'N/A'}°C, ${extras.weather?.description || 'N/A'}  

📋 Alineaciones confirmadas: ${extras.lineups.length > 0 ? 'Sí' : 'No'}  
🤕 Lesionados: ${extras.injuries.length}  
📈 Estadísticas: ${JSON.stringify(extras.stats)}  
📉 Historial directo: ${extras.h2h.length} partidos  
🧠 Jugadores analizados: ${extras.homePlayers.length + extras.awayPlayers.length}  
📊 Posiciones en tabla: ${JSON.stringify(extras.standings)}  
🥅 Goleadores clave: ${JSON.stringify(extras.topscorers)}  
🧠 Predicción IA oficial: ${JSON.stringify(extras.predictions)}

Genera un análisis avanzado usando estos datos e incluye:
- 🧠 Datos tácticos y psicológicos relevantes  
- 📌 Apuesta sugerida (principal, clara y razonada)  
- 📌 Apuestas extra (solo si hay señales reales como tendencia de goles, tarjetas, goleadores, clima extremo, etc.)  
- ⚠️ Advertencia responsable: “⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.”

Finalmente, estima de forma precisa y objetiva la probabilidad de éxito (en porcentaje) para la apuesta sugerida principal. Devuelve este número en formato JSON, como este ejemplo:

{"probabilidad": 0.72}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.85
      })
    });

    const out = await res.json();
    const texto = out.choices?.[0]?.message?.content || "";
    const regex = /{"probabilidad":\s*(0\.\d+|1\.0|1)}/i;
    const match = texto.match(regex);
    const probabilidadEstimada = match ? parseFloat(JSON.parse(match[0]).probabilidad) : 0.65;

    return { mensaje: texto, probabilidadEstimada };
  }

  async function enviarMensaje(mensaje) {
    const body = {
      authCode: AUTH_CODE,
      mensaje,
      honeypot: '',
      origin: 'https://punterx-panel-vip.netlify.app',
      timestamp
    };
    const firma = crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex');
    const res = await fetch(PANEL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': firma },
      body: JSON.stringify(body)
    });
    console.log("✅ Enviado a Telegram:", await res.text());
  }

  async function guardarEnMemoriaSupabase(pick) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(pick)
    });

    const data = await res.json();
    console.log("🧠 Pick guardado en Supabase:", data);
  } catch (err) {
    console.error("❌ Error guardando pick en Supabase:", err.message);
  }
}
  
  const partidos = filtrarPartidos(await obtenerPartidos());

  for (const partido of partidos) {
    const cuotas = await obtenerCuotas(partido);
    if (!cuotas) continue;

    const hora = new Date(partido.fixture.date).toLocaleTimeString("es-MX", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City"
    });

    const extras = await obtenerExtras(partido.fixture.id, partido.teams.home.id, partido.teams.away.id);
    const cuotaMinima = Math.min(cuotas.home, cuotas.away);

    const resultadoIA = await generarMensajeIA(partido, extras, cuotas, 0, null, hora);
    const probabilidadEstimada = resultadoIA.probabilidadEstimada;
    const ev = calcularEV(probabilidadEstimada, cuotaMinima);
    const nivel = clasificarNivel(ev);

    const esVIP = ev >= 15;
    const mensajeFinal = await generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, !esVIP);
    if (mensajeFinal?.mensaje) {
    await enviarMensaje(mensajeFinal.mensaje);
    await guardarEnMemoriaSupabase({
      equipo_local: partido.teams.home.name,
      equipo_visitante: partido.teams.away.name,
      liga: partido.league.name,
      pais: partido.league.country,
      cuota_local: cuotas.home,
      cuota_visitante: cuotas.away,
      cuota_empate: cuotas.draw,
      ev,
      nivel,
      hora_local: hora,
      mensaje: mensajeFinal.mensaje,
      es_vip: esVIP,
      probabilidad_estimada: probabilidadEstimada
    });
  }
}

// ✅ Esto va fuera del for
return {
  statusCode: 200,
  body: JSON.stringify({ ok: true })
};
