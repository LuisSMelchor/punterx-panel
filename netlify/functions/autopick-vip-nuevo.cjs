// autopick-vip.js FINAL PRO MAX - IA con todos los módulos activados

console.log("Despliegue forzado con nuevo nombre");

const fetch = globalThis.fetch;

async function guardarPickEnHistorial(data) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify([data])
    });

    const result = await response.json();
    console.log("✅ Pick guardado en historial:", result);
  } catch (e) {
    console.error("❌ Error guardando en historial:", e.message);
  }
}

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
    if (ev >= 15) return "Élite Mundial";
    if (ev >= 10) return "Avanzado";
    if (ev >= 5) return "Competitivo";
    return null;
  }

  async function yaFueEnviado(fixtureId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_enviados?fixture_id=eq.${fixtureId}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      }
    });
    const data = await res.json();
    return data.length > 0;
  }

  async function registrarPickEnviado(fixtureId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_enviados`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fixture_id: fixtureId,
        timestamp: new Date().toISOString()
      })
    });
    return await res.json();
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
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/${partido.league.id}/odds/?regions=us&markets=h2h&apiKey=${process.env.ODDS_API_KEY}`);
    const data = await res.json();

    const evento = data.find(e =>
      e.home_team.toLowerCase().includes(partido.teams.home.name.toLowerCase()) &&
      e.away_team.toLowerCase().includes(partido.teams.away.name.toLowerCase())
    );

    if (!evento || !evento.bookmakers || evento.bookmakers.length === 0) return null;

    const mejoresCuotas = { home: 0, draw: 0, away: 0 };

    for (const bm of evento.bookmakers) {
      if (!bm.markets || !bm.markets[0] || !bm.markets[0].outcomes) continue;

      bm.markets[0].outcomes.forEach(outcome => {
        if (outcome.name === "Home" && outcome.price > mejoresCuotas.home) mejoresCuotas.home = outcome.price;
        if (outcome.name === "Draw" && outcome.price > mejoresCuotas.draw) mejoresCuotas.draw = outcome.price;
        if (outcome.name === "Away" && outcome.price > mejoresCuotas.away) mejoresCuotas.away = outcome.price;
      });
    }

//     return [
// 🔴 CORREGIDO: return fuera de función
      { bookie: "Mejor Cuota", linea: "Local", valor: mejoresCuotas.home },
      { bookie: "Mejor Cuota", linea: "Empate", valor: mejoresCuotas.draw },
      { bookie: "Mejor Cuota", linea: "Visitante", valor: mejoresCuotas.away }
    ];
  } catch (e) {
    console.error("Error obteniendo cuotas:", e.message);
    return null;
  }
}
    
  }
  
  // 🔄 FUNCIÓN PARA OBTENER HISTORIAL DE PICKS ACERTADOS
async function obtenerHistorial() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos?select=fixture_id,equipos,apuesta,resultado_real,pick_acertado&pick_acertado=is.true&order=fecha.desc&limit=30`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    const historial = await res.json();

    if (!Array.isArray(historial)) return [];

    return historial.map(pick => {
      return `🟢 ${pick.equipos} → ${pick.apuesta}\nResultado: ${pick.resultado_real}`;
    }).join('\n\n');
  } catch (e) {
    console.error("Error al obtener historial:", e.message);
    return '';
  }
}

// 🤖 FUNCIÓN PRINCIPAL PARA GENERAR MENSAJE DE IA
async function generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, esGratis = false) {
  const historialTexto = await obtenerHistorial();

  const prompt = `
Eres una inteligencia artificial especializada en apuestas deportivas. Tienes acceso a información avanzada del partido y tu historial reciente de aciertos.

Tu objetivo es detectar oportunidades ocultas de valor en el mercado y explicar tu razonamiento de forma clara, profesional y convincente.

📚 Historial reciente de aciertos:
${historialTexto || 'Sin datos disponibles aún.'}

📊 Datos del partido actual:
- Equipos: ${partido.equipos}
- Liga: ${partido.liga}
- Hora (CDMX): ${hora}
- Cuotas: - Cuotas: ${Array.isArray(cuotas) ? cuotas.map(c => `${c.bookie}: ${c.linea} @ ${c.valor}`).join(' | ') : 'Cuotas no disponibles'}
- Valor Esperado (EV): ${ev.toFixed(1)}%
- Nivel: ${nivel}
${extras}

🎯 Tarea:
1. Explica por qué este partido tiene valor.
2. Identifica señales ocultas (racha, árbitro, forma, ausencias, etc.)
3. Concluye con una apuesta sugerida concreta (nombre y momio).

Responde en máximo 150 palabras. No hagas repeticiones. No menciones que eres una IA.
`;

  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.8,
      }),
    });

    const data = await respuesta.json();
    const textoIA = data.choices?.[0]?.message?.content || 'No se generó análisis.';

    return textoIA;
  } catch (e) {
    console.error("❌ Error generando análisis con IA:", e.message);
    return 'No se pudo generar el análisis.';
}
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

  // ✅ Validación para evitar errores si cuotas no es un array válido
  if (!Array.isArray(cuotas) || cuotas.length === 0) {
    console.warn(`⚠️ Cuotas no válidas para el partido: ${partido.equipos || partido.teams?.home?.name + ' vs ' + partido.teams?.away?.name}`);
    continue;
  }

  const hora = new Date(partido.fixture.date).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City"
  });

    const extras = await obtenerExtras(partido.fixture.id, partido.teams.home.id, partido.teams.away.id);
    const cuotaMinima = Math.min(
  cuotas.find(c => c.linea === "Local")?.valor || 0,
  cuotas.find(c => c.linea === "Visitante")?.valor || 0
);
    
    const resultadoIA = await generarMensajeIA(partido, extras, cuotas, 0, null, hora);

if (!resultadoIA || !resultadoIA.probabilidadEstimada) {
  console.log("⚠️ No se pudo generar probabilidad estimada para el partido:", partido.teams.home.name, "vs", partido.teams.away.name);
  continue; // 👈 evita que el script se rompa
}
    const probabilidadEstimada = resultadoIA.probabilidadEstimada;

    const ev = calcularEV(probabilidadEstimada, cuotaMinima);
    const nivel = clasificarNivel(ev);

    const esVIP = ev >= 1;
    const mensajeFinal = await generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, !esVIP);

        if (mensajeFinal?.mensaje) {
      const yaEnviado = await yaFueEnviado(partido.fixture.id);
      if (!yaEnviado) {
        await enviarMensaje(mensajeFinal.mensaje);
        await guardarPickEnHistorial({
          fecha: new Date().toISOString(),
          liga: partido.league.name,
          pais: partido.league.country,
          equipo_local: partido.teams.home.name,
          equipo_visitante: partido.teams.away.name,
          apuesta: mensajeFinal.apuesta || 'No definida',
          valor_esperado: ev,
          nivel_valor: nivel,
          probabilidad_estimada: probabilidadEstimada,
          cuotas: JSON.stringify(cuotas),
          analisis_ia: mensajeFinal.analisis || 'No disponible'
        });
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
        await registrarPickEnviado(partido.fixture.id);
      } else {
        console.log(`⚠️ Ya se envió el pick del fixture ${partido.fixture.id}, se omite.`);
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
}; // 👈 FIN correcto de exports.handler
async function obtenerCuotas(partido) {
  try {
    const response = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_odds/odds/?regions=eu&markets=h2h&bookmakers=bet365,10bet,williamhill,pinnacle,bwin&dateFormat=iso&oddsFormat=decimal&eventIds=${partido.odds_id}&apiKey=${ODDS_API_KEY}`);
    const data = await response.json();
    const oddsData = data[0]?.bookmakers || [];
    const mejoresCuotas = { home: 0, draw: 0, away: 0 };
    oddsData.forEach(bookmaker => {
      bookmaker.markets[0]?.outcomes.forEach(outcome => {
        if (outcome.name === 'Home' && outcome.price > mejoresCuotas.home) mejoresCuotas.home = outcome.price;
        if (outcome.name === 'Draw' && outcome.price > mejoresCuotas.draw) mejoresCuotas.draw = outcome.price;
        if (outcome.name === 'Away' && outcome.price > mejoresCuotas.away) mejoresCuotas.away = outcome.price;
      });
    });
    return [
      { bookie: 'Mejor Cuota', linea: 'Local', valor: mejoresCuotas.home },
      { bookie: 'Mejor Cuota', linea: 'Empate', valor: mejoresCuotas.draw },
      { bookie: 'Mejor Cuota', linea: 'Visitante', valor: mejoresCuotas.away }
    ];
  } catch (error) {
    console.error('Error al obtener cuotas:', error);
    return [];
  }
}
