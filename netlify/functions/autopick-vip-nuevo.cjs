// autopick-vip.js FINAL PRO MAX - IA con todos los módulos activados

console.log("Despliegue forzado con nuevo nombre");

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

  async function guardarPickEnHistorial(data) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify([data]),
      });
      const result = await response.json();
      console.log("✅ Pick guardado en historial:", result);
    } catch (e) {
      console.error("❌ Error guardando en historial:", e.message);
    }
  }

  function calcularEV(prob, cuota) {
    return Math.round((prob * cuota - 1) * 100);
  }

  function clasificarNivel(ev) {
    if (ev >= 30) return "🟣 Ultra Elite";
    if (ev >= 20) return "🎯 Élite Mundial";
    if (ev >= 10) return "🥈 Avanzado";
    if (ev >= 5) return "🥉 Competitivo";
    if (ev === 1) return "📄 Informativo";
    return null;
  }

  try {
  async function yaFueEnviado(fixtureId) {
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
      const res = await fetch(
        `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu&markets=h2h,over_under_2_5,btts,double_chance&bookmakers=bet365,10bet,williamhill,pinnacle,bwin&apiKey=${ODDS_API_KEY}`
      );
      const data = await res.json();
      const removeAccents = (txt) =>
        txt.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const nombreLocal = removeAccents(partido.teams.home.name.toLowerCase());
      const nombreVisita = removeAccents(partido.teams.away.name.toLowerCase());
      const fechaPartido = new Date(partido.fixture.date)
        .toISOString()
        .split("T")[0];

      const evento = data.find((e) => {
        const evLocal = removeAccents(e.home_team.toLowerCase());
        const evVisita = removeAccents(e.away_team.toLowerCase());
        const fechaEvento = new Date(e.commence_time)
          .toISOString()
          .split("T")[0];
        return (
          evLocal.includes(nombreLocal) &&
          evVisita.includes(nombreVisita) &&
          fechaEvento === fechaPartido
        );
      });

      if (!evento || !evento.bookmakers || evento.bookmakers.length === 0)
        return [];

      let mejorHome = 0,
        mejorDraw = 0,
        mejorAway = 0,
        bookie = "";
      const extras = [];

      for (const bm of evento.bookmakers) {
        for (const market of bm.markets) {
          if (!market.outcomes) continue;
          market.outcomes.forEach((o) => {
            const name = o.name.toLowerCase();
            const price = o.price;
            if (market.key === "h2h") {
              if (name includes(nombreLocal) && price > mejorHome) {
                mejorHome = price;
                bookie = bm.title;
              }
              if (name includes("draw") && price > mejorDraw) {
                mejorDraw = price;
              }
              if (name includes(nombreVisita) && price > mejorAway) {
                mejorAway = price;
                bookie = bm.title;
              }
            }
            if (market.key === "over_under_2_5" && name includes("over")) {
              extras.push({
                linea: "Over 2.5 goles",
                valor: price,
                bookie: bm.title,
              });
            }
            if (market.key === "btts" && name includes("yes")) {
              extras.push({
                linea: "Ambos anotan: sí",
                valor: price,
                bookie: bm.title,
              });
            }
            if (market key === "double_chance" && name includes("draw or")) {
              extras.push({
                linea: `Doble oportunidad ${o.name}`,
                valor: price,
                bookie: bm.title,
              });
            }
          });
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
      console.error("❌ Error obteniendo cuotas:", err.message);
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

  async function guardarEnMemoriaSupabase(pick) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(pick),
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
    const ev = calcularEV(probabilidadEstimada, cuotaMinima);
    const nivel = clasificarNivel(ev);

    if (ev < 15) continue;

    const yaEnviado = await yaFueEnviado(partido.fixture.id);
    if (yaEnviado) {
      console.log(
        `⚠️ Ya se envió el pick del fixture ${partido.fixture.id}, se omite.`
      );
      continue;
    }

    const infoGratis = await generarMensajeIA(
      partido,
      extras,
      cuotas,
      ev,
      nivel,
      hora,
      true
    );
    const infoVIP = await generarMensajeIA(
      partido,
      extras,
      cuotas,
      ev,
      nivel,
      hora,
      false
    );

    const mensajeGratis = construirMensaje(
      partido,
      hora,
      ev,
      nivel,
      infoGratis,
      cuotas,
      true
    );
    const mensajeVIP = construirMensaje(
      partido,
      hora,
      ev,
      nivel,
      infoVIP,
      cuotas,
      false
    );

    await enviarMensaje(mensajeGratis);
    await enviarMensaje(mensajeVIP);

    const insertData = {
      timestamp: new Date().toISOString(),
      fixture_id: partido.fixture.id,
      evento: `${partido.teams.home.name} vs ${partido.teams.away.name}`,
      equipos: `${partido.teams.home.name} vs ${partido.teams.away.name}`,
      liga: `${partido.league.country} - ${partido.league.name}`,
      analisis: infoVIP.analisis || "No disponible",
      apuesta: infoVIP.apuesta || "No definida",
      tipo_pick: nivel || "Sin nivel",
      ev: Number.isFinite(ev) ? Number(ev.toFixed(2)) : undefined,
      probabilidad: Number.isFinite(probabilidadEstimada)
        ? Number(probabilidadEstimada.toFixed(2))
        : undefined,
      nivel: nivel || "Sin clasificar",
    };
    for (const k of Object.keys(insertData)) {
      if (insertData[k] === undefined || insertData[k] === null) {
        delete insertData[k];
      }
    }
    await guardarPickEnHistorial(insertData);

    const cuotaLocal = cuotas.find((c) => c.linea === "Local")?.valor || 0;
    const cuotaEmpate = cuotas.find((c) => c.linea === "Empate")?.valor || 0;
    const cuotaVisitante =
      cuotas.find((c) => c.linea === "Visitante")?.valor || 0;

    await guardarEnMemoriaSupabase({
      equipo_local: partido.teams.home.name,
      equipo_visitante: partido.teams.away.name,
      liga: partido.league.name,
      pais: partido.league.country,
      cuota_local: cuotaLocal,
      cuota_visitante: cuotaVisitante,
      cuota_empate: cuotaEmpate,
      ev,
      nivel,
      hora_local: hora,
      mensaje: mensajeVIP,
      es_vip: true,
      probabilidad_estimada: probabilidadEstimada,
    });

    await registrarPickEnviado(partido.fixture.id);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};
