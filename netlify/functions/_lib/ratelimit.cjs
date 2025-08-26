'use strict';

// Mapa en memoria por proceso (Netlify/Node): suficiente para evitar duplicados cercanos.
const lastRunByKey = new Map();

/**
 * Devuelve true si está rate-limited; false si puede ejecutarse y registra timestamp.
 * windowMin: ventana en minutos (por defecto 20 o env RATE_LIMIT_MINUTES).
 */
function isRateLimited(key, windowMin) {
  const mins = Number(process.env.RATE_LIMIT_MINUTES || windowMin || 20);
  if (!key) return false;
  const now = Date.now();
  const prev = lastRunByKey.get(key) || 0;
  if (now - prev < mins * 60 * 1000) return true;
  lastRunByKey.set(key, now);
  return false;
}

module.exports = { isRateLimited };
