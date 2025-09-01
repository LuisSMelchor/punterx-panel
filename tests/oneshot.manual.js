const { handler } = require('../netlify/functions/run-pick-oneshot.cjs');

(async () => {
const r = await handler({ queryStringParameters: {
home: process.env.HOME_TEAM || 'Chelsea',
away: process.env.AWAY_TEAM || 'Fulham',
league: process.env.LEAGUE || 'Premier League',
commence: new Date(Date.now() + 90*60*1000).toISOString()
}});
const b = JSON.parse(r.body);

const keys = b?.markets ? Object.keys(b.markets) : (b?.markets_top3 ? Object.keys(b.markets_top3) : []);
console.log('statusCode:', r.statusCode);
const meta = b?.meta || b?.payload?.meta;
console.log('meta:', meta);
console.log('markets keys:', keys);
console.log('has_free:', !!b.message_free, 'has_vip:', !!b.message_vip);
if (b.message_free) console.log('\n--- FREE ---\n' + b.message_free);
if (b.message_vip) console.log('\n--- VIP ---\n' + b.message_vip);
})();
