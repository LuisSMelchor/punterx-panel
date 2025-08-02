const fetch = require('node-fetch');
const crypto = require('crypto');

exports.handler = async function () {
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

  async function obtenerPartidos() {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${fechaHoy}`, {
      method: 'GET',
      headers: { 'x-apisports-key': API_FOOTBALL_KEY }
    });
    const data = await res.json();
    return data.response;
  }

  function filtrarPartidosProximos(partidos) {
    const ahora = new Date();
    return partidos.filter(partido => {
      const inicioUTC = new Date(partido.fixture.date);
      const inicioCDMX = new Date(inicioUTC.getTime() - (5 * 60 * 60 * 1000));
      const minutosRestantes = (inicioCDMX - ahora) / 60000;
      return minutosRestantes > 44 && minutosRestantes < 56;
    });
  }

  async function obtenerCuotas(partido) {
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=us&markets=h2h&apiKey=${ODDS_API_KEY}`);
      const data = await res.json();
      const match = data.find(item =>
        item.home_team.toLowerCase().includes(partido.teams.home.name.toLowerCase()) &&
        item.away_team.toLowerCase().includes(partido.teams.away.name.toLowerCase())
      );
      if (!match || !match.bookmakers || match.bookmakers.length === 0) return null;
      return match.bookmakers[0].markets[0].outcomes;
    } catch (err) {
      console.error("⚠️ Error obteniendo cuotas:", err.message);
      return null;
    }
  }

  function calcularEV(prob, cuota) {
    return Math.round(((prob * cuota) - 1) * 100);
  }

  function clasificarNivel(ev) {
    if (ev >= 30) return "Élite Mundial";
    if (ev >= 20) return "Avanzado";
    if (ev >= 15) return "Competitivo";
    return null;
  }

  async function generarMensajeIA(infoPartido, nivel, cuotaLocal, cuotaVisitante, ev, hora, esGratis = false) {
    const prompt = `
Analiza el siguiente partido de fútbol y genera un mensaje ${esGratis ? 'para el canal gratuito' : 'para el grupo VIP'} con este formato:

${esGratis ? `
📌 Deporte: Fútbol  
🆚 Evento: ${infoPartido.teams.home.name} vs ${infoPartido.teams.away.name}  
🏆 Liga: ${infoPartido.league.name} (${infoPartido.league.country})  
📆 Fecha: ${fechaHoy} | 🕒 ${hora}  
💵 Cuota: ${cuotaLocal} vs ${cuotaVisitante}  
📈 Confianza: Alta  

🧠 Análisis de los expertos:  
[versión breve estilo humano]  

🤖 Análisis IA avanzada:  
[resumen atractivo y general]  

📌 Apuesta sugerida: [sugerencia simple]  

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.  

⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.
` : `
🎯 PICK NIVEL: ${nivel}  

📌 Deporte: Fútbol  
🆚 Evento: ${infoPartido.teams.home.name} vs ${infoPartido.teams.away.name}  
🏆 Liga: ${infoPartido.league.name} (${infoPartido.league.country})  
📆 Fecha: ${fechaHoy} | 🕒 ${hora}  
💵 Cuota: ${cuotaLocal} vs ${cuotaVisitante}  
📈 Confianza: Alta  

🧠 Análisis de los expertos:  
[opinión simulada breve]  

🤖 Análisis IA avanzada:  
[análisis profundo con factores ocultos: forma, valor esperado, cuotas, contexto táctico, etc.]  

📌 Apuesta sugerida: [APUESTA DESTACADA]  

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
`}`;

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

    const completion = await res.json();
    return completion.choices?.[0]?.message?.content || null;
  }

  async function enviarPick(mensaje) {
    const data = {
      authCode: AUTH_CODE,
      mensaje,
      honeypot: '',
      origin: 'https://punterx-panel-vip.netlify.app',
      timestamp
    };
    const firma = crypto.createHmac('sha256', SECRET).update(JSON.stringify(data)).digest('hex');
    const res = await fetch(PANEL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': firma
      },
      body: JSON.stringify(data)
    });
    console.log("📤 Enviado:", await res.text());
  }

  async function ejecutar() {
    const partidos = filtrarPartidosProximos(await obtenerPartidos());
    const grupoVIP = [], canalGratis = [];

    for (const partido of partidos) {
      const cuotas = await obtenerCuotas(partido);
      if (!cuotas) continue;

      const cuotaLocal = cuotas.find(c => c.name.toLowerCase().includes('home'))?.price || cuotas[0].price;
      const cuotaVisitante = cuotas.find(c => c.name.toLowerCase().includes('away'))?.price || cuotas[1].price;
      const cuotaMinima = Math.min(cuotaLocal, cuotaVisitante);
      const ev = calcularEV(0.65, cuotaMinima);

      const hora = new Date(partido.fixture.date).toLocaleTimeString("es-MX", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City"
      });

      if (ev >= 15) {
        grupoVIP.push({ partido, cuotaLocal, cuotaVisitante, ev, hora });
      } else if (ev === 14) {
        canalGratis.push({ partido, cuotaLocal, cuotaVisitante, ev, hora });
      }
    }

    for (const pick of grupoVIP) {
      const nivel = clasificarNivel(pick.ev);
      const mensaje = await generarMensajeIA(pick.partido, nivel, pick.cuotaLocal, pick.cuotaVisitante, pick.ev, pick.hora);
      if (mensaje) await enviarPick(mensaje);
    }

    if (canalGratis.length > 0) {
      const mejor = canalGratis.sort((a, b) => b.ev - a.ev)[0];
      const mensaje = await generarMensajeIA(mejor.partido, '', mejor.cuotaLocal, mejor.cuotaVisitante, mejor.ev, mejor.hora, true);
      if (mensaje) await enviarPick(mensaje);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "✅ Ejecución completada." })
    };
  }

  return await ejecutar();
};
