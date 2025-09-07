// netlify/functions/autopick-vip-run3.cjs
// PunterX · Autopick VIP Run3 — guardrails inspect/bypass
'use strict';

const __json = (code, obj) => ({
  statusCode: code,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(obj),
});
const qbool = (v) => v === '1' || v === 'true' || v === 'yes';

exports.handler = async (event) => {
  const qs = (event && event.queryStringParameters) || {};
  const headers = {};
  try {
    const raw = (event && event.headers) || {};
    for (const k in raw) {
      const v = raw[k];
      headers[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
  } catch {}

  // Guardrails: inspect -> 200 ; bypass -> 403
  if (qbool(qs.inspect)) {
    const hasDbgHeader = !!headers['x-debug-token'] || !!headers['x-debug'];
    return __json(200, { ok: true, guard: 'inspect', debug_header: hasDbgHeader ? 'present' : 'absent' });
  }
  if (qbool(qs.bypass)) {
    return __json(403, { ok: false, guard: 'bypass', error: 'forbidden' });
  }

  // Ping rápido
  if (qbool(qs.ping)) {
    return __json(200, { ok: true, ping: 'autopick-vip-run3 (pong)' });
  }

  // Por defecto: 204 silencioso
  return { statusCode: 204, body: '' };
};
