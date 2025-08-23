// Minimalísimo: CJS puro, nada externo, siempre JSON plano
exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: "{\"ok\":true,\"ping\":\"autopick-vip-scheduler alive (minimal)\"}"
  };
};
