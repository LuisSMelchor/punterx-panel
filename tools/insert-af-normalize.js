const fs = require('fs');
const file = 'netlify/functions/_lib/af-resolver.cjs';
let src = fs.readFileSync(file, 'utf8');

// buscamos el primer "reason: 'sin_team_id'" y ubicamos el "return" anterior
const key = "reason: 'sin_team_id'";
const posReason = src.indexOf(key);
if (posReason < 0) {
  console.error("No encontré \"reason: 'sin_team_id'\" en af-resolver.cjs");
  process.exit(1);
}

// retrocede hasta el "return" que pertenece a ese objeto
let i = posReason;
let returnStart = -1;
while (i >= 0) {
  if (src.slice(i, i+6) === 'return') { returnStart = i; break; }
  i--;
}
if (returnStart < 0) {
  console.error('No pude localizar el "return" asociado a sin_team_id');
  process.exit(1);
}

// insertamos el bloque ANTES del return
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
  const byNorm = (list || []).reduce((acc,t) => (acc[normalize(t.name)] = t, acc), {});
  const nHome = byNorm[normHome];
  const nAway = byNorm[normAway];

  if (nHome && nAway) {
    console.log("[MATCH-HELPER] Normalized match success", { home, away, homeId: nHome.id, awayId: nAway.id });
    return { ok: true, homeId: nHome.id, awayId: nAway.id, reason: 'normalized' };
  }
} catch(e) {
  console.warn("[MATCH-HELPER] normalize fallback error:", e && e.message || e);
}
`;

const newSrc = src.slice(0, returnStart) + patch + src.slice(returnStart);
fs.writeFileSync(file, newSrc, 'utf8');
console.log('OK: normalización añadida antes de sin_team_id');
