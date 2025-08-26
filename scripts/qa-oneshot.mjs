import https from 'https';
import http from 'http';

function get(url) {
  return new Promise((resolve, reject) => {
    const useHttps = url.startsWith('https://');
    const mod = useHttps ? https : http;
    const u = new URL(url);
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      timeout: Number(process.env.HTTP_TIMEOUT_MS || 6500)
    }, (res) => {
      let data=''; res.on('data',d=>data+=d);
      res.on('end',()=>{ try{ resolve(JSON.parse(data)); } catch{ resolve({ raw:data }); } });
    });
    req.on('timeout',()=>{ req.destroy(new Error('timeout')); });
    req.on('error',reject);
    req.end();
  });
}

const base = process.env.QA_BASE || 'http://localhost:8888';
const cases = (process.env.QA_FIXTURES || '').split('|').filter(Boolean).map(s => {
  const [home, away, league, commence] = s.split(',');
  return { home, away, league, commence };
});

if (!cases.length) {
  cases.push({ home:'Charlotte FC', away:'New York Red Bulls', league:'Major League Soccer', commence:'2025-08-24T23:00:00Z' });
}

const rows = [];
for (const c of cases) {
  const qs = new URLSearchParams(c).toString();
  const url = `${base}/.netlify/functions/oneshot-publish?${qs}`;
  const r = await get(url);
  rows.push({ ...c, nivel: r.nivel || r.status, ev: r.ev ?? '-', trace: r.result_trace || '-' });
}

const widths = { home:22, away:22, league:24, commence:20, nivel:12, ev:8, trace:12 };
function pad(s,w){ s=String(s); return s.length>=w?s.slice(0,w):s+' '.repeat(w-s.length); }

console.log(
  pad('HOME',widths.home),
  pad('AWAY',widths.away),
  pad('LEAGUE',widths.league),
  pad('COMMENCE',widths.commence),
  pad('NIVEL',widths.nivel),
  pad('EV',widths.ev),
  pad('TRACE',widths.trace)
);
for (const r of rows) {
  console.log(
    pad(r.home,widths.home),
    pad(r.away,widths.away),
    pad(r.league,widths.league),
    pad(r.commence,widths.commence),
    pad(r.nivel,widths.nivel),
    pad(r.ev,widths.ev),
    pad(r.trace,widths.trace)
  );
}
