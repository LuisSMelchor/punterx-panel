// tests/send_report.smoke.js
const { handler } = require('../netlify/functions/run-pick-oneshot.cjs');

async function check(qs, label){
  const r = await handler({ queryStringParameters: qs });
  const b = JSON.parse(r.body);
  const sr = b.send_report || {};
  const enabled = (String(process.env.SEND_ENABLED)==='1');
  const expect_missing_vip  = enabled && !!b.message_vip;
  const expect_missing_free = enabled && !!b.message_free;
  const ok = (sr.enabled===enabled) &&
             (Boolean(sr.missing_vip_id)===expect_missing_vip) &&
             (Boolean(sr.missing_free_id)===expect_missing_free);
  console.log(`[${label}]`, ok?'✅ OK':'❌ MISMATCH',
              { sr, has_vip:!!b.message_vip, has_free:!!b.message_free });
  if (!ok) process.exit(1);
}

(async()=>{
  delete process.env.TG_VIP_CHAT_ID;
  delete process.env.TG_FREE_CHAT_ID;
  process.env.SEND_ENABLED='1';
  delete process.env.MIN_VIP_EV;

  await check({home:'Chelsea',away:'Arsenal',league:'Premier League',commence:new Date(Date.now()+9e6).toISOString()}, 'Case 1');
  await check({home:'Chelsea',away:'Fulham',league:'Premier League',commence:new Date(Date.now()+9e6).toISOString()}, 'Case 2');
  process.env.MIN_VIP_EV='5';
  await check({home:'Chelsea',away:'Fulham',league:'Premier League',commence:new Date(Date.now()+9e6).toISOString()}, 'Case 3 (VIP forzado)');
})();
