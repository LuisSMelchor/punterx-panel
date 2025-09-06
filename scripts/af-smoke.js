/* Smoke reproducible para AF (PunterX)
   Criterio PASS por caso:
   - status=200 Y (counts.window>0 O h2h.closest!=null)
   Salida proceso: 0 si todos pasan, 1 si alguno falla
*/
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

function safeJSON(s){ try { return JSON.parse(s||"{}"); } catch { return {}; } }

async function main() {
  autoloadEnv();
  const hQuick  = require('../netlify/functions/diag-af-quick.cjs').handler;
  const hWindow = require('../netlify/functions/diag-af-windoweval.cjs').handler;

  const cases = [
    { home:"Real Madrid",  away:"Barcelona",    when_text:"2025-04-20", league_hint:"La Liga",         country_hint:"Spain",     pad:"14" },
    { home:"Arsenal",      away:"Chelsea",      when_text:"2025-05-12", league_hint:"Premier League",  country_hint:"England",   pad:"14" },
    { home:"Boca Juniors", away:"River Plate",  when_text:"2025-03-02", league_hint:"Copa de la Liga", country_hint:"Argentina", pad:"14" },
  ];

  let fails = 0;
  for (const c of cases) {
    const rq = await hQuick ( { queryStringParameters:c }, {} );
    const rw = await hWindow( { queryStringParameters:c }, {} );
    const jq = safeJSON(rq.body), jw = safeJSON(rw.body);

    const quickOK  = rq.statusCode === 200 && jq?.ids?.home?.id && jq?.ids?.away?.id;
    const windowOK = rw.statusCode === 200 && ((jw?.counts?.window||0) > 0 || (jw?.h2h?.closest != null));

    const line = [
      `[CASE] ${c.home} vs ${c.away}`,
      `quick=${quickOK? 'OK':'FAIL'}`,
      `window=${windowOK? 'OK':'FAIL'}`,
      `ids=${jw?.ids? `{H:${jw.ids.home?.id||'-'} A:${jw.ids.away?.id||'-'}}` : '-'}`,
      `win=${(jw?.counts?.window)||0}`,
      `h2h=${jw?.h2h?.closest?.fixture_id||'null'}`
    ].join(' | ');
    console.log(line);

    if (!quickOK || !windowOK) fails++;
    await new Promise(r=>setTimeout(r,250)); // pacing ligero
  }

  if (fails === 0) {
    console.log("SMOKE: PASS");
    process.exitCode = 0;
  } else {
    console.log(`SMOKE: FAIL (${fails} caso(s))`);
    process.exitCode = 1;
  }
}

main().catch(e=>{
  console.log("SMOKE: ERROR", e && (e.stack || e.message || e));
  process.exitCode = 1;
});
