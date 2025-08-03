// autopick-vip.js FINAL

const fetch = globalThis.fetch;

export async function handler() {
  const crypto = await import('node:crypto');

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

  async function obtenerExtras(fixtureId) {
    const headers = { 'x-apisports-key': API_FOOTBALL_KEY };
    const [lineups, injuries, stats, h2h, referee] = await Promise.all([
      fetch(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/injuries?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures/headtohead?h2h=${fixtureId}`, { headers }).then(r => r.json()),
      fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, { headers }).then(r => r.json())
    ]);
    return {
      lineups: lineups.response,
      injuries: injuries.response,
      stats: stats.response,
      h2h: h2h.response,
      referee: referee.response?.[0]?.fixture?.referee || null
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
    const prompt = `Analiza este partido y genera un mensaje ${esGratis ? 'para el canal gratuito' : 'para el grupo VIP'}:

Equipos: ${partido.teams.home.name} vs ${partido.teams.away.name}  
Liga: ${partido.league.name} (${partido.league.country})  
Fecha: ${fechaHoy} | Hora: ${hora} CDMX  
Cuotas: ${cuotas.home} vs ${cuotas.away}  
EV: ${ev}%  
Nivel: ${nivel || 'N/A'}  
Referee: ${extras.referee || 'Desconocido'}

Lineups confirmados: ${extras.lineups.length > 0 ? 'Sí' : 'No'}  
Lesionados: ${extras.injuries.length}  

Estadísticas: ${JSON.stringify(extras.stats)}  
Historial directo: ${extras.h2h.length} partidos

Genera un análisis con estos datos y sugiere:
- 🧠 Datos avanzados
- 📌 Apuesta sugerida (resultado principal)
- 📌 Apuestas extra (solo si hay señales claras como tarjetas, goles, jugadores clave, árbitro, etc.)
- ⚠️ Advertencia final para ambos mensajes.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8
      })
    });

    const out = await res.json();
    return out.choices?.[0]?.message?.content || null;
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

  const partidos = filtrarPartidos(await obtenerPartidos());

  for (const partido of partidos) {
    const cuotas = await obtenerCuotas(partido);
    if (!cuotas) continue;

    const probabilidadEstimada = 0.65;
    const cuotaMinima = Math.min(cuotas.home, cuotas.away);
    const ev = calcularEV(probabilidadEstimada, cuotaMinima);

    const hora = new Date(partido.fixture.date).toLocaleTimeString("es-MX", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City"
    });

    const extras = await obtenerExtras(partido.fixture.id);
    const nivel = clasificarNivel(ev);

    const esVIP = ev >= 15;
    const mensaje = await generarMensajeIA(partido, extras, cuotas, ev, nivel, hora, !esVIP);
    if (mensaje) await enviarMensaje(mensaje);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
}
