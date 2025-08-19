// netlify/functions/_lib/af-resolver.cjs
// CommonJS — Wrapper mínimo de API‑Football v3
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BASE = 'https://v3.football.api-sports.io';

async function afApi(path, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const url = `${BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': process.env.API_FOOTBALL_KEY,
      'x-rapidapi-ua': 'ChatGPT-PunterX',
      'Accept': 'application/json'
    },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`AF ${path} ${res.status}`);
  return await res.json();
}

module.exports = { afApi };
