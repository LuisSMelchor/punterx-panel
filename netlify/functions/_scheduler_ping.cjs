// Minimalísimo: no toca event/context, no usa process, siempre JSON plano
exports.handler = async function() {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: "{\"ok\":true,\"ping\":\"scheduler alive (minimal)\"}"
  };
};
