// autopick-vip.js FINAL PRO MAX - IA con todos los módulos activados

const fetch = globalThis.fetch;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const PANEL_ENDPOINT = process.env.PANEL_ENDPOINT;
const AUTH_CODE = process.env.AUTH_CODE;
const SECRET = process.env.PUNTERX_SECRET;

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

    async function obtenerCuotas(fixtureId) {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu&markets=h2h&apiKey=${ODDS_API_KEY}`);
    const data = await res.json();
    const partido = data.find(p => p.id === fixtureId);
    if (!partido) return null;

    const cuotas = partido.bookmakers?.[0]?.markets?.[0]?.outcomes;
    if (!cuotas) return null;

    return {
      home: cuotas.find(o => o.name === partido.home_team)?.price || null,
      away: cuotas.find(o => o.name === partido.away_team)?.price || null,
      draw: cuotas.find(o => o.name === "Draw")?.price || null
    };
  }

  async function generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, esGratis) {
    const prompt = `Analiza el partido ${partido.teams.home.name} vs ${partido.teams.away.name}. 
Datos:
- Cuotas: local ${cuotas.home}, empate ${cuotas.draw}, visitante ${cuotas.away}
- Nivel detectado: ${nivel}
- Valor esperado (EV): ${ev}%
- Hora del partido (CDMX): ${hora}
- Lesiones: ${extras.injuries.length}
- Árbitro: ${extras.referee || 'No disponible'}
- Clima: ${extras.weather?.description || 'Sin datos'}

Redacta un análisis profesional. Al final, sugiere UNA apuesta concreta si se detecta oportunidad clara.`;
    
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const data = await res.json();
    const contenido = data.choices?.[0]?.message?.content || "Análisis no disponible.";

    const apuesta = contenido.split("Apuesta sugerida:")[1]?.trim() || null;
    const analisis = contenido.split("Apuesta sugerida:")[0]?.trim();

    return {
      mensaje: esGratis
        ? `⚽ ${partido.teams.home.name} vs ${partido.teams.away.name}\n\n${analisis}\n\n⚠️ Este contenido es informativo. Apostar conlleva riesgo.`
        : `⚽ ${partido.teams.home.name} vs ${partido.teams.away.name}\n\n${analisis}\n\n🎯 Apuesta sugerida: ${apuesta || "No disponible"}\n\n⚠️ Este contenido es informativo. Apostar conlleva riesgo.`,
      apuesta,
      analisis
    };
  }

  async function guardarEnMemoriaSupabase(data) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/memoria_picks`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([data])
      });
      const result = await res.json();
      console.log("📥 Guardado en memoria Supabase:", result);
    } catch (e) {
      console.error("❌ Error guardando en memoria:", e.message);
    }
  }

  const partidos = await obtenerPartidos();
  const filtrados = filtrarPartidos(partidos);

  for (const partido of filtrados) {
    const hora = new Date(partido.fixture.date).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City' });

    const extras = await obtenerExtras(
      partido.fixture.id,
      partido.teams.home.id,
      partido.teams.away.id
    );

    const cuotas = await obtenerCuotas(partido.fixture.id);
    if (!cuotas) continue;

    const resultadoIA = await generarMensajeIA(partido, extras, cuotas, 0, "Exploración", hora, true);

    if (!resultadoIA || !resultadoIA.mensaje) continue;

    const probabilidadEstimada = 0.55; // ejemplo fijo por ahora
    const ev = calcularEV(probabilidadEstimada, cuotas.home);
    const nivel = clasificarNivel(ev);
    const esVIP = ev >= 15;

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
};
