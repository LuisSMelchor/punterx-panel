// Sanity ping: siempre responde JSON para verificar que el runtime ejecuta la función
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      msg: "scheduler alive",
      qs: event?.queryStringParameters || null,
      node: process.version
    })
  };
};
