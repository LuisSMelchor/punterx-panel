'use strict';

// Handler mínimo para evitar 404 en prod; reemplázalo por la lógica real.
// Lee ?evt=... (URL-encoded JSON) y responde estructura esperada.
module.exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const evtRaw = qs.evt || '';
  let evt = null;
  try { evt = evtRaw ? JSON.parse(decodeURIComponent(evtRaw)) : null; } catch (_) {}

  // Estructura base de respuesta (vacía): { bookmakers: [] }
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ ok: true, evt, bookmakers: [] }),
  };
};
