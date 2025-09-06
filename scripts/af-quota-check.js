const fs = require('fs');

function autoloadEnv() {
  if (!process.env.API_FOOTBALL_KEY) {
    try {
      const t = fs.readFileSync('.env','utf8');
      for (const line of t.split(/\r?\n/)) {
        const m = line.match(/^\s*API_FOOTBALL_KEY\s*=\s*(.+)\s*$/);
        if (m) { process.env.API_FOOTBALL_KEY = m[1].trim(); break; }
      }
    } catch {}
  }
}

async function main(){
  autoloadEnv();
  const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL || process.env.APIFOOTBALL_KEY || '';
  if (!key) {
    console.log(JSON.stringify({ ok:false, error:'NO_API_FOOTBALL_KEY' }));
    return;
  }
  const AF = 'https://v3.football.api-sports.io';
  // [AF_SENTINEL_QUOTA_V1]
const res = await fetch(AF + '/status', { headers: { 'x-apisports-key': key } });
  const j = await res.json().catch(()=>null);
if (process.env.AF_DEBUG) console.log('[AF_DEBUG] /status payload=', JSON.stringify(j));
  // [AF_QUOTA_PARSER_V1]
  const pathA = j?.response?.requests;
  const pathB = j?.response?.account?.requests;
  const cur = (pathA?.current ?? pathB?.current ?? null);
  const lim = (pathA?.limit_day ?? pathB?.limit_day ?? null);
  const ratio = (cur != null && lim) ? (cur/lim) : null;
  const warn = (ratio != null) ? (ratio >= 0.8) : null;
  console.log(JSON.stringify({ ok:true, current:cur, limit:lim, ratio, warn }, null, 2));
}
main().catch(e=>console.log(JSON.stringify({ ok:false, error:String(e&&e.message||e) })));
