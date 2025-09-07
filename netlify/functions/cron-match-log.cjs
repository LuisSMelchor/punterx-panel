// netlify/functions/cron-match-log.cjs
'use strict';
const ok = (o) => ({ statusCode:200, headers:{'content-type':'application/json'}, body: JSON.stringify(o) });
exports.config = { schedule: '*/15 * * * *' }; // cada 15 minutos

exports.handler = async (event) => {
  const now = new Date().toISOString();
  const scheduled = !!(event?.headers?.['x-nf-scheduled']);
  console.log('[MATCHDBG] heartbeat', { now, scheduled });

  // Nota: aquí NO llamamos APIs; solo simulamos un conteo “near”
  // En el futuro, este cron puede leer de cache/kv si decidimos persistir “near”
  const nearInfo = { size: null, note: 'no-cache' };

  return ok({ ok:true, now, scheduled, nearInfo });
};
