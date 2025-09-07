/* scripts/smoke-functions.js */
'use strict';

// Usa fetch global (Node 18+) o cae a node-fetch v2 si hace falta
let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch {
    console.error('No hay fetch disponible. Instala node-fetch o usa Node 18+.');
    process.exit(1);
  }
}

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:8888';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

// Normaliza BASE: soporta raíz del sitio o base con /.netlify/functions
function toUrl(base, path) {
  const b = String(base || '').replace(/\/$/, '');
  if (b.endsWith('/.netlify/functions')) {
    return b + String(path || '').replace(/^\/\.netlify\/functions/, '');
  }
  return b + String(path || '');
}

// Endpoints a probar
const INCLUDE_RUN3 = /netlify\.app/i.test(BASE) || process.env.SMOKE_INCLUDE_RUN3 === '1';
const targets = [
  // run2 foreground (ping) + background
  { path: '/.netlify/functions/autopick-vip-run2?ping=1', label: 'autopick-vip-run2', expectStatuses: [200, 204] },
  { path: '/.netlify/functions/autopick-vip-run2-background', label: 'autopick-vip-run2-background', expectStatuses: [202, 200, 204] },

  // diag-impl-call guardrails
  { path: '/.netlify/functions/diag-impl-call?inspect=1', label: 'diag-impl-call (inspect)', expectStatuses: [200] },
  { path: '/.netlify/functions/diag-impl-call?bypass=1',  label: 'diag-impl-call (bypass)',  expectStatuses: [403] },

  // Compat prod: mientras reponemos run2 en producción
  { path: '/.netlify/functions/autopick-vip-run3', label: 'autopick-vip-run3', expectStatuses: [200, 204, 403], optional: true },
];
const effectiveTargets = targets.filter(t => !t.optional || INCLUDE_RUN3);

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms));
}

async function hit(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('abort'), TIMEOUT_MS);

  try {
    const res = await fetchFn(url, { signal: controller.signal });
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    return { status: res.status, body: text.slice(0, 400) }; // muestra solo un snippet
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  console.log(`SMOKE | Base: ${BASE}`);
  let failures = 0;

  for (const t of (typeof effectiveTargets !== "undefined" ? effectiveTargets : targets)) {
    const url = toUrl(BASE, t.path);
    process.stdout.write(`→ ${t.label} ${url} ... `);

    try {
      const { status, body } = await Promise.race([hit(url), timeout(TIMEOUT_MS)]);
      const ok = t.expectStatuses.includes(status);
      console.log(ok ? `OK [${status}]` : `FAIL [${status}]`);
      if (!ok) {
        failures++;
        console.log(`   body: ${body || '(vacío)'}`);
      }
    } catch (e) {
      failures++;
      console.log(`ERR ${e?.message || e}`);
    }
  }

  if (failures > 0) {
    console.error(`SMOKE | Fallas: ${failures}`);
    process.exit(1);
  } else {
    console.log('SMOKE | Todo OK');
  }
})();
