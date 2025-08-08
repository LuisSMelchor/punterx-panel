// autopick-vip-nuevo.cjs FINAL - Full IA Picks System

const fetch = globalThis.fetch;
exports.handler = async function () {
  try {
    const crypto = await import("node:crypto");
    const {
      SUPABASE_URL,
      SUPABASE_KEY,
      OPENAI_API_KEY,
      API_FOOTBALL_KEY,
      ODDS_API_KEY,
      TELEGRAM_BOT_TOKEN,
      TELEGRAM_VIP_ID,
      TELEGRAM_FREE_CHANNEL,
    } = process.env;

    const headersSupabase = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    };

    const today = new Date().toISOString().split("T")[0];
    console.log(`📅 Buscando partidos para hoy ${today}`);

    const response = await fetch(`https://api.the-odds-api.com/v4/sports/soccer/events/?apiKey=${ODDS_API_KEY}&regions=eu,us,uk&markets=h2h,totals,spreads,btts,draw_no_bet,double_chance&oddsFormat=decimal&dateFormat=iso&bookmakers=bet365,10bet,bwin,williamhill`);
    const matches = await response.json();
    const partidosHoy = matches.filter(m => m.commence_time.startsWith(today));
    console.log(`📊 Total partidos hoy: ${partidosHoy.length}`);

    for (const match of partidosHoy) {
      const {id, home_team, away_team, commence_time, bookmakers} = match;
      const evento = `${home_team} vs ${away_team}`;
      const hora = new Date(commence_time);
      const tiempoRestante = Math.floor((hora - new Date()) / (60 * 1000));
      if (tiempoRestante < 45 || tiempoRestante > 55) continue;

      console.log(`🔍 Consultando cuotas para: ${evento}`);
      if (!bookmakers || bookmakers.length === 0) {
        console.log(`⚠️ No hay casas de apuestas para ${evento}`);
        continue;
      }

      const mejoresCuotas = {};
      for (const bookie of bookmakers) {
        for (const market of bookie.markets || []) {
          for (const outcome of market.outcomes || []) {
            const clave = `${market.key}:${outcome.name}`;
            if (!mejoresCuotas[clave] || outcome.price > mejoresCuotas[clave].cuota) {
              mejoresCuotas[clave] = {
                cuota: outcome.price,
                bookie: bookie.title,
              };
            }
          }
        }
      }

      // Llamar a API-FOOTBALL para enriquecer con info avanzada
      const statsResponse = await fetch(`https://v3.football.api-sports.io/fixtures?team=${encodeURIComponent(home_team)}&season=2024`, {
        headers: {
          "x-apisports-key": API_FOOTBALL_KEY,
        },
      });

      const statsData = await statsResponse.json();
      const infoExtra = statsData.response ? statsData.response[0] : null;

      const prompt = {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Eres un experto en análisis deportivo con enfoque en apuestas de valor. Tu tarea es analizar el partido y calcular la probabilidad real estimada, además de sugerir una apuesta principal y apuestas extra si hay señales fuertes. Responde en JSON estricto, sin explicaciones. Campos: probabilidad_estimada (0-100), analisis_profesional, apuesta_sugerida, apuestas_extra (array de strings), frase_publica_teaser."
          },
          {
            role: "user",
            content: `Partido: ${evento}\nHora: ${hora.toISOString()}\nCuotas disponibles: ${JSON.stringify(mejoresCuotas)}\nInfo adicional: ${JSON.stringify(infoExtra)}`
          }
        ],
        temperature: 0.7
      };

      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(prompt),
      });

      const aiResult = await openaiRes.json();
      const data = JSON.parse(aiResult.choices[0].message.content);

      const { probabilidad_estimada, analisis_profesional, apuesta_sugerida, apuestas_extra, frase_publica_teaser } = data;
      const ev = ((mejoresCuotas["h2h:"+apuesta_sugerida]?.cuota || 1.5) * (probabilidad_estimada/100)) - 1;
      const evPorcentaje = Math.round(ev * 100);

      let nivel = "📄 Informativo";
      if (evPorcentaje >= 40) nivel = "🟣 Ultra Elite";
      else if (evPorcentaje >= 30) nivel = "🎯 Élite Mundial";
      else if (evPorcentaje >= 20) nivel = "🥈 Avanzado";
      else if (evPorcentaje >= 15) nivel = "🥉 Competitivo";

      const mensajeVIP = `🎯 PICK NIVEL: ${nivel}\n📅 ${evento}\n🕒 Comienza en ${tiempoRestante} minutos\n📊 Probabilidad estimada: ${probabilidad_estimada}%\n💰 EV: ${evPorcentaje}%\n🎲 Apuesta sugerida: ${apuesta_sugerida}\n📌 Apuestas extra: ${apuestas_extra.join(" | ")}\n\n📚 Datos avanzados:\n${analisis_profesional}\n\n⚠️ Este contenido es informativo. Juega con responsabilidad.`;

      const mensajeGratis = `📡 RADAR DE VALOR\n📅 ${evento}\n🕒 Comienza en ${tiempoRestante} minutos\n📚 ${frase_publica_teaser}\n\n👉 Únete gratis por 15 días: @punterxpicksVIP`;

      if (evPorcentaje >= 15) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_VIP_ID,
            text: mensajeVIP,
          })
        });
      }

      if (evPorcentaje >= 10) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_FREE_CHANNEL,
            text: mensajeGratis,
          })
        });
      }

      // Guardar en Supabase si EV >= 14
      if (evPorcentaje >= 14) {
        await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
          method: "POST",
          headers: headersSupabase,
          body: JSON.stringify({
            evento,
            liga: match.sport_title,
            equipos: `${home_team} vs ${away_team}`,
            ev: evPorcentaje,
            probabilidad: probabilidad_estimada,
            analisis: analisis_profesional,
            apuesta: apuesta_sugerida,
            tipo_pick: nivel,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Proceso completado correctamente." }),
    };
  } catch (error) {
    console.error("❌ Error en autopick:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
