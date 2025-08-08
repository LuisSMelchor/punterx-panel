const fetch = globalThis.fetch;

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PANEL_ENDPOINT = process.env.PANEL_ENDPOINT;
const AUTH_CODE = process.env.AUTH_CODE;
const SECRET = process.env.PUNTERX_SECRET;

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

for (const [key, val] of Object.entries(required)) {
  if (!val) throw new Error(`❌ Variable de entorno faltante: ${key}`);
}

const mapaLigasOddsAPI = {
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Liga MX": "soccer_mexico_liga_mex",
  "Serie A": "soccer_italy_serie_a",
  "Bundesliga": "soccer_germany_bundesliga",
  "Ligue 1": "soccer_france_ligue_one",
};

async function obtenerPartidos(fechaHoy) {
  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?date=${fechaHoy}`,
    {
      headers: { "x-apisports-key": API_FOOTBALL_KEY },
    }
  );
  const data = await res.json();

  if (!Array.isArray(data.response)) {
    console.error("❌ Error al obtener fixtures:", data);
    return [];
  }

  return data.response;
}

async function obtenerCuotas(partido) {
  try {
    const sportKey = mapaLigasOddsAPI[partido.liga] || "soccer";
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?regions=eu&markets=h2h,totals,btts,double_chance&bookmakers=bet365,10bet,williamhill,pinnacle,bwin&apiKey=${ODDS_API_KEY}`;

    console.log(`🔍 Consultando cuotas para: ${partido.equipos || "Sin nombre definido"}`);

    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`❌ HTTP ${res.status} al obtener cuotas → ${errorText}`);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn("⚠️ Respuesta inesperada de OddsAPI:", data);
      return [];
    }

    return data;
  } catch (error) {
    console.error("❌ Error al obtener cuotas:", error);
    return [];
  }
}

exports.handler = async function () {
  try {
    const fechaHoy = new Date().toISOString().split("T")[0];
    const partidos = await obtenerPartidos(fechaHoy);

    if (partidos.length === 0) {
      console.log("⚠️ No se encontraron partidos hoy.");
    } else {
      console.log(`📅 ${partidos.length} partidos encontrados para hoy ${fechaHoy}.`);
    }

    // Simulación de lectura de cuotas para el primer partido (solo como prueba)
    const partidoPrueba = partidos[0];
    if (partidoPrueba) {
      const cuotas = await obtenerCuotas({
        liga: partidoPrueba.league?.name,
        equipos: `${partidoPrueba.teams?.home?.name} vs ${partidoPrueba.teams?.away?.name}`,
      });

      if (cuotas.length === 0) {
        console.log("⚪ No se encontraron cuotas para este partido.");
      } else {
        console.log(`✅ Cuotas obtenidas: ${cuotas.length} mercados encontrados.`);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        msg: "🟢 Script ejecutado con éxito. Validación y prueba completadas.",
      }),
    };
  } catch (err) {
    console.error("❌ Error durante ejecución:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Fallo en ejecución del handler" }),
    };
  }
};
