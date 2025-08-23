// Siempre responde JSON. Usa fetch global (Node 18+) y es tolerante a texto no-JSON.
exports.handler = async () => {
  try {
    const base =
      process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      "https://punterx-panel-vip.netlify.app";

    const url = `${base}/.netlify/functions/autopick-vip-run2?from=scheduler`;
    const res = await fetch(url, { headers: { "x-nf-scheduled": "1" } });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

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
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e?.message || String(e) })
    };
  }
};
