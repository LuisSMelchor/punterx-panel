// autopick-vip.js FINAL PRO MAX - IA con todos los módulos activados

const fetch = globalThis.fetch;

const ODDS_API_KEY = process.env.ODDS_API_KEY;

exports.handler = async function () {
  const crypto = await import("node:crypto");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
  const PANEL_ENDPOINT = process.env.PANEL_ENDPOINT;
  const AUTH_CODE = process.env.AUTH_CODE;
  const SECRET = process.env.PUNTERX_SECRET;

  // ✅ Validación de variables de entorno
  const required = {
    SUPABASE_URL,
    SUPABASE_KEY,
    OPENAI_API_KEY,
    API_FOOTBALL_KEY,
    ODDS_API_KEY,
    PANEL_ENDPOINT,
    AUTH_CODE,
    SECRET,
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value) {
      console.error(`❌ Falta la variable de entorno ${name}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: `Missing env var: ${name}` }),
      };
    }
  }

  const now = new Date();
  const nowUTC = new Date(now.toUTCString());
  const horaCDMX = new Date(nowUTC.getTime() - 5 * 60 * 60 * 1000);
  const fechaHoy = horaCDMX.toISOString().split("T")[0];
  const timestamp = Date.now();

async function generarMensajeIA(partido) {
  const prompt = `
Eres un experto en análisis táctico y apuestas deportivas. A partir de los siguientes datos del partido, genera el siguiente JSON:

{
  "analisis_gratuito": "Breve análisis para el canal gratuito",
  "frase_motivacional": "Frase que invite a confiar en la IA y a unirse al grupo VIP",
  "analisis_vip": "Análisis profundo y táctico para usuarios VIP",
  "apuesta": "La mejor apuesta sugerida según el análisis",
  "apuestas_extra": ["Opción 1", "Opción 2"]
}

Datos del partido:
Liga: ${partido.liga}
Equipos: ${partido.equipos}
Fixture ID: ${partido.fixture_id}
Hora estimada: ${partido.hora}
Forma actual: ${partido.forma || "No disponible"}
Alineaciones confirmadas: ${partido.alineaciones || "No disponibles"}
Lesionados: ${partido.lesionados || "No disponibles"}
Historial de enfrentamientos: ${partido.historial || "No disponible"}
Árbitro y estadísticas: ${partido.arbitro || "No disponible"}
Cuotas promedio del mercado: ${partido.cuotas || "No disponibles"}
Clima estimado: ${partido.clima || "No disponible"}

Responde únicamente con el JSON solicitado.
  `.trim();

  try {
    const config = new Configuration({ apiKey: OPENAI_API_KEY });
    const openai = new OpenAIApi(config);

    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });

    const respuesta = completion.data.choices[0].message.content.trim();

    let resultado;
    try {
      resultado = JSON.parse(respuesta);
    } catch (err) {
      console.error('❌ Error al parsear respuesta de OpenAI:', err.message);
      return null;
    }

    return resultado;
  } catch (err) {
    console.error('❌ Error al generar mensaje IA:', err.message);
    return null;
  }
}
  
  async function guardarPickEnSupabase(data) {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/picks_historicos?on_conflict=fixture_id`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify([data]),
        }
      );
      const result = await response.json();
      console.log("✅ Pick guardado en historial:", result);
    } catch (e) {
      console.error("❌ Error guardando en historial:", e.message);
    }
  }

  function calcularEV(prob, cuota) {
    const p = Number(prob);
    const c = Number(cuota);
    if (!isFinite(p) || !isFinite(c) || c <= 0) return 0;
    return Math.round((p * c - 1) * 100);
  }

  function clasificarNivel(ev) {
    if (ev >= 30) return "🟣 Ultra Elite";
    if (ev >= 20) return "🎯 Élite Mundial";
    if (ev >= 10) return "🥈 Avanzado";
    if (ev >= 5) return "🥉 Competitivo";
    return null;
  }

  async function yaFueEnviado(fixtureId) {
    try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/picks_enviados?fixture_id=eq.${fixtureId}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    const data = await res.json();
    return data.length > 0;
  } catch (error) {
    console.error('❌ Error en yaFueEnviado:', error.message);
    return false;
  }
  }

  async function registrarPickEnviado(fixtureId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_enviados`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fixture_id: fixtureId,
        timestamp: new Date().toISOString(),
      }),
    });
    return await res.json();
  }

  async function obtenerPartidos() {
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${fechaHoy}`,
      { headers: { "x-apisports-key": API_FOOTBALL_KEY } }
    );
    const data = await res.json();
    return data.response;
  }

  function filtrarPartidos(partidos) {
    const ahora = new Date();
    return partidos.filter((p) => {
      const inicio = new Date(p.fixture.date);
      const minutos = (inicio - ahora) / 60000;
      return minutos > 44 && minutos < 56;
    });
  }

  // ✅ Manejo robusto de APIs externas con Promise.allSettled
  async function obtenerExtras(fixtureId, homeId, awayId, leagueId) {
    const headers = { "x-apisports-key": API_FOOTBALL_KEY };

    const requests = [
      fetch(
        `https://v3.football.api-sports.io/fixtures/lineups?fixture=${fixtureId}`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/injuries?fixture=${fixtureId}`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/fixtures/statistics?fixture=${fixtureId}`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/fixtures/headtohead?h2h=${homeId}-${awayId}`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/players?team=${homeId}&season=2024`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/players?team=${awayId}&season=2024`,
        { headers }
      ).then((r) => r.json()),
      // ✅ standings y topscorers usan ahora leagueId
      fetch(
        `https://v3.football.api-sports.io/standings?league=${leagueId}&season=2024`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/players/topscorers?league=${leagueId}&season=2024`,
        { headers }
      ).then((r) => r.json()),
      fetch(
        `https://v3.football.api-sports.io/predictions?fixture=${fixtureId}`,
        { headers }
      ).then((r) => r.json()),
    ];

    const [
      lineupsRes,
      injuriesRes,
      statsRes,
      h2hRes,
      fixtureDetailRes,
      homePlayersRes,
      awayPlayersRes,
      standingsRes,
      topscorersRes,
      predictionsRes,
    ] = await Promise.allSettled(requests);

    const safe = (res) => (res.status === "fulfilled" ? res.value : {});

    const fixtureDetail = safe(fixtureDetailRes);
    const referee = fixtureDetail.response?.[0]?.fixture?.referee || null;
    const weather = fixtureDetail.response?.[0]?.fixture?.weather || null;

    return {
      lineups: safe(lineupsRes).response || [],
      injuries: safe(injuriesRes).response || [],
      stats: safe(statsRes).response || [],
      h2h: safe(h2hRes).response || [],
      referee,
      weather,
      homePlayers: safe(homePlayersRes).response || [],
      awayPlayers: safe(awayPlayersRes).response || [],
      standings: safe(standingsRes).response || [],
      topscorers: safe(topscorersRes).response || [],
      predictions: safe(predictionsRes).response || [],
    };
  }

  async function obtenerCuotas(partido) {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu&markets=h2h,totals,btts,double_chance&bookmakers=bet365,10bet,williamhill,pinnacle,bwin&apiKey=${ODDS_API_KEY}`;

    console.log(`🔍 Consultando cuotas para: ${partido.equipos || 'Sin nombre definido'}`);
    console.log(`📦 Datos del partido:`, {
      liga: partido.liga,
      fixture_id: partido.fixture_id,
      equipos: partido.equipos,
    });

    const res = await fetch(url);

    if (!res.ok) {
      const errorText = await res.text(); // Detalles del error
      console.warn(`⚠️ Cuotas no válidas para: ${partido.equipos || 'Partido sin nombre'}`);
      console.warn(`❌ HTTP ${res.status} al obtener cuotas → ${errorText}`);
      return [];
    }

    const raw = await res.json();

    if (raw && raw.success === false) {
      console.warn(`❌ OddsAPI respondió con error: ${raw.message || raw.msg}`);
      return [];
    }

    const data = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];

    console.log(`✅ Cuotas recibidas correctamente para: ${partido.equipos || 'Sin nombre'}`);
    return obtenerMejoresCuotasSeguras(data, partido);
  } catch (err) {
    console.warn(`❌ Error al obtener cuotas para ${partido.equipos || 'Partido sin nombre'}:`, err.message);
    return [];
    }
  }

  function obtenerMejoresCuotasSeguras(data, partido) {
    try {
      if (!Array.isArray(data)) {
        console.warn("⚠️ Formato de cuotas no es un array:", data);
        return [];
      }
      const removeAccents = (txt) => txt.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const nombreLocal = removeAccents(partido.teams.home.name.toLowerCase());
      const nombreVisita = removeAccents(partido.teams.away.name.toLowerCase());
      const fechaPartido = new Date(partido.fixture.date)
        .toISOString()
        .split("T")[0];

      const evento = data.find((e) => {
        if (!e || !e.home_team || !e.away_team) return false;
        const evLocal = removeAccents(String(e.home_team).toLowerCase());
        const evVisita = removeAccents(String(e.away_team).toLowerCase());
        const fechaEvento = new Date(e.commence_time)
          .toISOString()
          .split("T")[0];
        return (
          evLocal.includes(nombreLocal) &&
          evVisita.includes(nombreVisita) &&
          fechaEvento === fechaPartido
        );
      });

      if (!evento || !Array.isArray(evento.bookmakers) || evento.bookmakers.length === 0) {
        console.warn(
          "⚠️ Evento no encontrado o sin bookmakers:",
          partido?.fixture?.id
        );
        return [];
      }

      let mejorHome = 0,
        mejorDraw = 0,
        mejorAway = 0,
        bookie = "";
      const extras = [];

      for (const bm of evento.bookmakers) {
        if (!Array.isArray(bm.markets)) continue;
        for (const market of bm.markets) {
          if (!Array.isArray(market.outcomes)) continue;
          for (const o of market.outcomes) {
            const name = o.name.toLowerCase();
            const price = o.price;
            if (market.key === "h2h") {
              if (name.includes(nombreLocal) && price > mejorHome) {
                mejorHome = price;
                bookie = bm.title;
              }
              if (name.includes("draw") && price > mejorDraw) {
                mejorDraw = price;
              }
              if (name.includes(nombreVisita) && price > mejorAway) {
                mejorAway = price;
                bookie = bm.title;
              }
            }
            if (market.key === "over_under_2_5" && name.includes("over")) {
              extras.push({
                linea: "Over 2.5 goles",
                valor: price,
                bookie: bm.title,
              });
            }
            if (market.key === "btts" && name.includes("yes")) {
              extras.push({
                linea: "Ambos anotan: sí",
                valor: price,
                bookie: bm.title,
              });
            }
            if (market.key === "double_chance" && name.includes("draw or")) {
              extras.push({
                linea: `Doble oportunidad ${o.name}`,
                valor: price,
                bookie: bm.title,
              });
            }
          }
        }
      }

      if (mejorHome < 1 || mejorAway < 1) return [];

      return [
        { linea: "Local", valor: mejorHome, bookie },
        { linea: "Empate", valor: mejorDraw, bookie },
        { linea: "Visitante", valor: mejorAway, bookie },
        ...extras,
      ];
    } catch (err) {
      console.error("❌ Error procesando cuotas:", err.message);
      return [];
    }
  }

  async function obtenerHistorial() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/picks_historicos?select=fixture_id,equipos,apuesta,resultado_real,pick_acertado&pick_acertado=is.true&order=fecha.desc&limit=30`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const historial = await res.json();
      if (!Array.isArray(historial)) return "";

      return historial
        .map(
          (pick) =>
            `🟢 ${pick.equipos} → ${pick.apuesta}\nResultado: ${pick.resultado_real}`
        )
        .join("\n\n");
    } catch (e) {
      console.error("Error al obtener historial:", e.message);
      return "";
    }
  }

  async function generarMensajeIA(
    partido,
    extras,
    cuotas,
    ev,
    nivel,
    hora,
    esGratis = false
  ) {
    const historialTexto = await obtenerHistorial();
    const cuotasTexto = Array.isArray(cuotas)
      ? cuotas.map((c) => `${c.bookie}: ${c.linea} @ ${c.valor}`).join(" | ")
      : "Cuotas no disponibles";

    const basePrompt = `Eres una inteligencia artificial especializada en apuestas deportivas. Analiza el siguiente partido utilizando la información disponible.\n\n📚 Historial reciente de aciertos:\n${
      historialTexto || "Sin datos disponibles aún."
    }\n\n📊 Datos del partido actual:\n- Equipos: ${
      partido.equipos
    }\n- Liga: ${partido.liga}\n- Hora (CDMX): ${hora}\n- Cuotas: ${cuotasTexto}\n- Valor Esperado (EV): ${ev.toFixed(
      1
    )}%\n- Nivel: ${nivel}`;

    const tareaGratis =
      "\n\nRedacta un análisis breve sin revelar la apuesta sugerida. Concluye invitando a unirte al grupo VIP. Devuelve tu respuesta en formato JSON con las claves 'analisis' y 'apuesta' (deja 'apuesta' vacía).";

    const tareaVIP =
      "\n\nRedacta un análisis profesional y concluye con una apuesta sugerida concreta (nombre y momio). Devuelve tu respuesta en formato JSON con las claves 'analisis' y 'apuesta'.";

    const prompt = basePrompt + (esGratis ? tareaGratis : tareaVIP);

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
      const contenido = data.choices?.[0]?.message?.content || "{}";
      try {
        return JSON.parse(contenido);
      } catch {
        return { analisis: contenido, apuesta: "" };
      }
    } catch (e) {
      console.error("❌ Error generando análisis con IA:", e.message);
      return { analisis: "No se pudo generar el análisis.", apuesta: "" };
    }
  }

  function construirMensaje(partido, hora, ev, nivel, infoIA, cuotas, esGratis) {
    const equipos = `${partido.teams.home.name} vs ${partido.teams.away.name}`;
    if (esGratis) {
      return `📡 RADAR DE VALOR\n\n${equipos}\nHora: ${hora} (CDMX)\nEV estimado: ${ev.toFixed(
        1
      )}% | Nivel: ${nivel}\n\n${infoIA.analisis}\n\n🚀 Únete a nuestro grupo VIP para recibir la apuesta sugerida y picks exclusivos.\n👉 https://t.me/+qmgqwj5tZVM2NDQx`;
    }

    const extras = cuotas.filter(
      (c) => ["Local", "Empate", "Visitante"].indexOf(c.linea) === -1
    );
    const extrasTexto = extras
      .map((e) => `• ${e.linea} @ ${e.valor} (${e.bookie})`)
      .join("\n");

    return `🎯 PICK NIVEL: ${nivel}\n${equipos} (${partido.league.name})\nHora: ${hora} (CDMX)\nEV estimado: ${ev.toFixed(
      1
    )}%\n\n${infoIA.analisis}\n\nApuesta sugerida: ${infoIA.apuesta}\n${
      extrasTexto ? `\nApuestas extra:\n${extrasTexto}\n` : ""
    }⚠️ Las apuestas implican riesgo. Juega con responsabilidad.`;
  }

  async function enviarMensaje(mensaje) {
    const body = {
      authCode: AUTH_CODE,
      mensaje,
      honeypot: "",
      origin: "https://punterx-panel-vip.netlify.app",
      timestamp,
    };
    const firma = crypto
      .createHmac("sha256", SECRET)
      .update(JSON.stringify(body))
      .digest("hex");
    const res = await fetch(PANEL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": firma },
      body: JSON.stringify(body),
    });
    console.log("✅ Enviado a Telegram:", await res.text());
  }

  const partidos = filtrarPartidos(await obtenerPartidos());

  for (const partido of partidos) {
    // Construir correctamente el objeto partido para obtenerCuotas
partido.liga = `${partido.league?.name || 'Sin liga'} (${partido.league?.country || 'País desconocido'})`;
partido.equipos = `${partido.teams?.home?.name || 'Equipo local'} vs ${partido.teams?.away?.name || 'Equipo visitante'}`;
partido.fixture_id = partido.fixture?.id || null;
    const cuotas = await obtenerCuotas(partido);

    if (!Array.isArray(cuotas) || cuotas.length === 0) {
      console.warn(
        `⚠️ Cuotas no válidas para el partido: ${
          partido.equipos ||
          partido.teams?.home?.name + " vs " + partido.teams?.away?.name
        }`
      );
      continue;
    }

    const hora = new Date(partido.fixture.date).toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Mexico_City",
    });

    const extras = await obtenerExtras(
      partido.fixture.id,
      partido.teams.home.id,
      partido.teams.away.id,
      partido.league.id
    );

    const cuotasFiltradas = cuotas.filter((c) => c.valor && !isNaN(c.valor));
    const cuotaMinima =
      cuotasFiltradas.length > 0
        ? Math.min(...cuotasFiltradas.map((c) => parseFloat(c.valor)))
        : 0;

    const predHome = extras.predictions?.[0]?.percent?.home;
    const probabilidadEstimada = predHome ? parseFloat(predHome) / 100 : 0;

        if (!cuotaMinima || isNaN(cuotaMinima)) {
          console.log("⚠️ Cuota inválida detectada, skip pick");
          continue;
        }

    // 🧠 Obtener análisis desde OpenAI (una sola llamada)
const datosIA = await generarMensajeIA(partido);

if (!datosIA) {
  console.warn(`⚠️ OpenAI falló para el partido: ${partido.equipos}`);
  continue;
}

// ✅ Mensaje para canal gratuito
const mensajeGratis = `
📡 RADAR DE VALOR
${partido.equipos}
${datosIA.analisis_gratuito}

${datosIA.frase_motivacional}

🚀 Únete al grupo VIP por 15 días gratis: https://t.me/+qmgqwj5tZVM2NDQx
⚠️ Apuesta con responsabilidad.
`.trim();

// 🎯 Mensaje para grupo VIP
const mensajeVIP = `
🎯 PICK NIVEL: ${partido.nivel || 'Hallazgo VIP'}
${partido.equipos}
EV: ${partido.ev}% | Prob. estimada: ${partido.probabilidad}%
💡 Apuesta sugerida: ${datosIA.apuesta}
🎯 Apuestas extra: ${datosIA.apuestas_extra?.join(' • ') || 'Ninguna'}

${datosIA.analisis_vip}

⚠️ Este contenido es informativo. Apuesta de forma responsable.
`.trim();

// 🚀 Envío automático a Telegram
await enviarMensaje(mensajeGratis, false); // Canal gratuito
await enviarMensaje(mensajeVIP, true);     // Grupo VIP

    const pickData = {
      timestamp: new Date().toISOString(),
      fixture_id: partido.fixture.id,
      evento: `${partido.teams.home.name} vs ${partido.teams.away.name}`,
      equipos: `${partido.teams.home.name} vs ${partido.teams.away.name}`,
      liga: `${partido.league.country} - ${partido.league.name}`,
      analisis: infoVIP.analisis || "No disponible",
      apuesta: infoVIP.apuesta || "No definida",
      tipo_pick: nivel || "Sin nivel",
      ev: Number.isFinite(ev) ? Number(ev.toFixed(2)) : null,
      probabilidad_estimada: Number.isFinite(probabilidadEstimada)
        ? Number(probabilidadEstimada.toFixed(2))
        : null,
      nivel: nivel || "Sin clasificar",
      cuota_local: cuotaLocal,
      cuota_visitante: cuotaVisitante,
      cuota_empate: cuotaEmpate,
      hora_local: hora,
      mensaje: mensajeVIP,
      es_vip: true,
    };
    for (const k of Object.keys(pickData)) {
      if (pickData[k] === undefined || pickData[k] === null) {
        delete pickData[k];
      }
    }
    await guardarPickEnSupabase(pickData);

    await registrarPickEnviado(partido.fixture.id);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
