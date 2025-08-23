const fs = require('fs');
const file = 'netlify/functions/_lib/af-resolver.cjs';
let src = fs.readFileSync(file, 'utf8');

const needle = "return { ok: false, reason: 'sin_team_id' };";
if (!src.includes(needle)) {
  console.error("No encontré el return { ok: false, reason: 'sin_team_id' }; en af-resolver.cjs");
  process.exit(1);
}

const patch = `
// Fallback de normalización básica antes de descartar por sin_team_id
try {
  const normalize = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")
      .replace(/\\b(club de futbol|club de fútbol|club deportivo|football club|futbol club|futebol clube|fc|cf|cd|sc|ac|afc|sfc|cfc)\\b/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();

  const normHome = normalize(home);
  const normAway = normalize(away);

  const nHome = (list || []).find(t => normalize(t.name) === normHome);
  const nAway = (list || []).find(t => normalize(t.name) === normAway);

  if (nHome && nAway) {
    console.log("[MATCH-HELPER] Normalized match success", { home, away, homeId: nHome.id, awayId: nAway.id });
    return { ok: true, homeId: nHome.id, awayId: nAway.id, reason: 'normalized' };
  }
} catch(e) {
  console.warn("[MATCH-HELPER] normalize fallback error:", e && e.message || e);
}
` + needle;

src = src.replace(needle, patch);
fs.writeFileSync(file, src, 'utf8');
console.log("OK: normalización ligera añadida en", file);
