// tests/send_report.edges.js
const { handler } = require('../netlify/functions/run-pick-oneshot.cjs');

async function call(qs) {
  const r = await handler({ queryStringParameters: qs });
  return JSON.parse(r.body);
}

(async () => {
  // — Case 0: SEND_ENABLED=0 => disabled y sin flags activos
  delete process.env.TG_VIP_CHAT_ID;
  delete process.env.TG_FREE_CHAT_ID;
  process.env.SEND_ENABLED = '0';
  let b = await call({ home:'X', away:'Y' });
  if (b.send_report?.enabled !== false) throw new Error('Case 0: enabled debería ser false');
  if (b.send_report?.missing_vip_id || b.send_report?.missing_free_id) {
    throw new Error('Case 0: flags missing_* deben ser falsy cuando está deshabilitado');
  }

  // — Case 1: SEND_ENABLED=1 con IDs presentes => si hay mensajes, missing_* debe ser false
  process.env.SEND_ENABLED = '1';
  process.env.TG_VIP_CHAT_ID = '123';
  process.env.TG_FREE_CHAT_ID = '456';
  delete process.env.MIN_VIP_EV;

  b = await call({
    home:'Chelsea', away:'Arsenal', league:'Premier League',
    commence: new Date(Date.now()+9e6).toISOString()
  });
  if (b.message_vip  && b.send_report?.missing_vip_id)  throw new Error('Case 1: missing_vip_id debería ser false con ID presente');
  if (b.message_free && b.send_report?.missing_free_id) throw new Error('Case 1: missing_free_id debería ser false con ID presente');

  // — Case 2: Forzar VIP con ID presente => missing_vip_id sigue false
  process.env.MIN_VIP_EV = '5';
  b = await call({
    home:'Chelsea', away:'Fulham', league:'Premier League',
    commence: new Date(Date.now()+9e6).toISOString()
  });
  if (b.message_vip && b.send_report?.missing_vip_id) throw new Error('Case 2: missing_vip_id debería ser false con ID presente');

  console.log('OK: edge cases');
})().catch((e) => { console.error(e); process.exit(1); });
