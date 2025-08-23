// Scheduler robusto: siempre JSON, con trazas, y sin dependencias externas.
exports.handler = async () => {
  try {
    const base =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      "https://punterx-panel-vip.netlify.app";

    const url = `${base}/.netlify/functions/autopick-vip-run2?from=scheduler`;

    // Traza temprana para ver si el handler siquiera arranca
    console.log("[scheduler] start", { node: process.version, base });

    // Usa fetch nativo si existe; si no, reporta claramente
    const f = globalThis.fetch;
    if (typeof f !== "function") {
      console.error("[scheduler] fetch no disponible en runtime");
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "fetch no disponible (Node < 18?)" })
      };
    }

    const res = await f(url, { headers: { "x-nf-scheduled": "1" } });
    const text = await res.text();

    let json = null;
    try { json = JSON.parse(text); } catch {}

    console.log("[scheduler] done", { status: res.status, hasJSON: !!json });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ok: true,
        triggered: "run2",
        status: res.status,
        resumen: json?.resumen ?? null,
        raw: json ? undefined : text
      })
    };
  } catch (e) {
    console.error("[scheduler] error", e);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) })
    };
  }
};
