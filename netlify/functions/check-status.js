const fetch = globalThis.fetch;

export async function handler() {
  const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

  try {
    const res = await fetch("https://v3.football.api-sports.io/status", {
      headers: {
        "x-apisports-key": API_FOOTBALL_KEY
      }
    });

    const json = await res.json();
    console.log("✅ Respuesta API-SPORTS:", json);

    return {
      statusCode: 200,
      body: JSON.stringify(json)
    };
  } catch (error) {
    console.error("❌ Error llamando a API-SPORTS:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
