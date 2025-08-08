// ✅ AUTOPICK-VIP-NUEVO COMPLETO - MONITOREO GLOBAL CON ODDSAPI + ENRIQUECIDO POR API-FOOTBALL + IA

const fetch = globalThis.fetch;
const crypto = await import('node:crypto');

// 🔐 ENV VARIABLES
const {
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  PANEL_ENDPOINT,
  AUTH_CODE,
  PUNTERX_SECRET,
} = process.env;

// ✅ VALIDACIÓN ENV VARIABLES
for (const [key, val] of Object.entries({
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  PANEL_ENDPOINT,
  AUTH_CODE,
  PUNTERX_SECRET,
})) {
  if (!val) throw new Error(`❌ Falta la variable de entorno: ${key}`);
}

// 📆 OBTENER FECHA EN ZONA CDMX
function obtenerFechaHoraCDMX() {
  const hoy = new Date().toLocaleString("en-US", {
    timeZone: "America/Mexico_City",
  });
  return new Date(hoy);
}

// 📅 DENTRO DE RANGO DE 45-55 MINUTOS
function estaDentroDelRango(fechaInicio) {
  const ahora = obtenerFechaHoraCDMX();
  const diffMin = (fechaInicio - ahora) / (1000 * 60);
  return diffMin >= 45 && diffMin <= 55;
}

// 🔁 OBTENER PARTIDOS DESDE ODDSAPI
async function obtenerPartidosDesdeOddsAPI() {
  const url = `https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu&markets=h2h,totals,btts,double_chance&bookmakers=bet365,10bet,williamhill,pinnacle,bwin&apiKey=${ODDS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`❌ Error al obtener partidos: ${res.status} → ${errorText}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// 📋 MAPEAR INFO DEL PARTIDO
function mapearPartidoOdds(raw) {
  const equipos = `${raw.home_team} vs ${raw.away_team}`;
  const fecha = new Date(raw.commence_time);
  return {
    equipos,
    fecha,
    id_odds: raw.id,
    source: raw,
  };
}

// 🔎 VALIDAR Y ENRIQUECER CON API-FOOTBALL
async function obtenerFixtureDesdeAPIFootball(equipos, fecha) {
  const fechaISO = fecha.toISOString().split("T")[0];
  const url = `https://v3.football.api-sports.io/fixtures?date=${fechaISO}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY },
  });
  const data = await res.json();
  const lista = Array.isArray(data.response) ? data.response : [];
  return lista.find(f => f.teams.home.name.includes(equipos.split(" vs ")[0]));
}

// 📈 CALCULAR EV
function calcularValorEsperado(probabilidad, cuota) {
  return (cuota * probabilidad - 1).toFixed(2);
}

// 📊 CLASIFICAR NIVEL
function clasificarNivelEV(ev) {
  const val = parseFloat(ev);
  if (val >= 0.4) return "🟣 Ultra Elite";
  if (val >= 0.3) return "🎯 Élite Mundial";
  if (val >= 0.2) return "🥈 Avanzado";
  if (val >= 0.15) return "🥉 Competitivo";
  if (val >= 0.1) return "📄 Informativo";
  return null;
}

// 🤖 ESTIMAR PROBABILIDAD Y ANÁLISIS CON IA
async function generarAnalisisIA(partido, cuota) {
  const prompt = `Dado el partido ${partido.equipos}, y una cuota de ${cuota}, analiza ambos equipos y genera:
  - Probabilidad estimada de éxito
  - Análisis breve profesional (VIP)
  - Frase teaser atractiva (para canal gratuito)

Devuélvelo en JSON con campos: probabilidad, analisis, teaser`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return JSON.parse(text);
}

// 🧪 GUARDAR EN SUPABASE
async function guardarPickEnSupabase(pick) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/picks_historicos`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(pick),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error("❌ Error al guardar en Supabase:", txt);
  }
}

// 📤 ENVIAR A TELEGRAM
async function enviarMensajeTelegram(mensaje, isVIP) {
  const payload = {
    authCode: AUTH_CODE,
    timestamp: Date.now(),
    match: mensaje,
  };

  const signature = crypto.createHmac("sha256", PUNTERX_SECRET)
    .update(`${payload.timestamp}:${payload.match}`)
    .digest("hex");

  const body = {
    ...payload,
    signature,
  };

  await fetch(PANEL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 🚀 HANDLER PRINCIPAL
exports.handler = async function () {
  const partidosOdds = await obtenerPartidosDesdeOddsAPI();
  for (const raw of partidosOdds) {
    const partido = mapearPartidoOdds(raw);
    if (!estaDentroDelRango(partido.fecha)) continue;

    const fixture = await obtenerFixtureDesdeAPIFootball(partido.equipos, partido.fecha);
    if (!fixture) continue;

    const cuota = raw.bookmakers?.[0]?.markets?.[0]?.outcomes?.[0]?.price;
    if (!cuota) continue;

    const analisis = await generarAnalisisIA(partido, cuota);
    const ev = calcularValorEsperado(analisis.probabilidad, cuota);
    const nivel = clasificarNivelEV(ev);
    if (!nivel) continue;

    const pick = {
      evento: partido.equipos,
      liga: fixture.league.name + " - " + fixture.league.country,
      equipos: partido.equipos,
      analisis: analisis.analisis,
      teaser: analisis.teaser,
      apuesta: `Cuota ${cuota}`,
      ev,
      probabilidad: analisis.probabilidad,
      tipo_pick: nivel,
      timestamp: new Date().toISOString(),
    };

    await guardarPickEnSupabase(pick);

    const mensaje = nivel.includes("Elite") ?
      `🎯 PICK NIVEL: ${nivel}\n${pick.liga} | ${pick.evento}\nEV: ${ev}, Prob: ${analisis.probabilidad}\n${analisis.analisis}\n👉 ${pick.apuesta}` :
      `📡 RADAR DE VALOR\n${pick.liga} | ${pick.evento}\n${analisis.teaser}\nÚnete gratis al VIP: @punterxpicks`;

    await enviarMensajeTelegram(mensaje, nivel.includes("Elite"));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, msg: "✅ Picks generados y enviados correctamente." }),
  };
};
