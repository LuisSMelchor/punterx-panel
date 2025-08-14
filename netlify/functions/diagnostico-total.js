// netlify/functions/diagnostico-total.js
// PunterX — Diagnóstico Total (HTML Pro + JSON)
// UI pro: Tailwind (Play CDN) + Chart.js (CDN). Mantiene JSON (as-is) si ?json=1|true.
// No borra la lógica existente: intenta usar _diag-core-v4.cjs si está presente.
// CommonJS, sin top-level await.

"use strict";

/* ============================================================
 *  BLINDAJE DE RUNTIME
 * ============================================================ */
try {
  if (typeof fetch === "undefined") {
    global.fetch = require("node-fetch");
  }
} catch (_) {}

try {
  process.on("uncaughtException", (e) => {
    try { console.error("[UNCAUGHT]", e && (e.stack || e.message || e)); } catch {}
  });
  process.on("unhandledRejection", (e) => {
    try { console.error("[UNHANDLED]", e && (e.stack || e.message || e)); } catch {}
  });
} catch (_) {}

/* ============================================================
 *  IMPORTS & ENV
 * ============================================================ */
const path = require("path");

// Core opcional (si existe, se usa como fuente de verdad)
let core = null;
try {
  core = require("./_diag-core-v4.cjs"); // si no existe, fallback más abajo
  console.log("[DIAG] _diag-core-v4.cjs detectado");
} catch {
  console.log("[DIAG] _diag-core-v4.cjs no disponible, usaré fallback mínimo");
}

const {
  SUPABASE_URL,
  SUPABASE_KEY,
  OPENAI_API_KEY,
  ODDS_API_KEY,
  API_FOOTBALL_KEY,
  TELEGRAM_BOT_TOKEN,
} = process.env;

/* ============================================================
 *  HELPERS UI (no afectan lógica)
 * ============================================================ */
function badge(ok) {
  return ok
    ? '<span class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">OK</span>'
    : '<span class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800">Error</span>';
}
function kfmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return String(v);
}
function esc(s) {
  return String(s ?? "").replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]));
}

/* ============================================================
 *  RENDER HTML (UI PRO)
 * ============================================================ */
function renderDashboardHTML(payload) {
  const {
    ok = true,
    at,
    ciclo_ms,
    resumen = {},
    apis = {},
    picksRecientes = [],
    erroresRecientes = [],
    // Campos opcionales:
    oai_cost_usd = null,
  } = payload || {};

  const cards = [
    { name: "Ejecuciones hoy", value: kfmt(resumen.ejecuciones_hoy || 0) },
    { name: "Picks VIP enviados", value: kfmt(resumen.vip || 0) },
    { name: "Picks FREE enviados", value: kfmt(resumen.free || 0) },
    { name: "OpenAI $ (hoy)", value: oai_cost_usd != null ? "$" + Number(oai_cost_usd).toFixed(2) : "—" },
  ];

  const apiRows = [
    { name: "Supabase", ok: !!apis.supabase_ok, detail: apis.supabase_msg || "" },
    { name: "OpenAI", ok: !!apis.openai_ok, detail: apis.openai_model || apis.openai_msg || "" },
    { name: "OddsAPI", ok: !!apis.odds_ok, detail: apis.odds_quota || apis.odds_msg || "" },
    { name: "API‑FOOTBALL", ok: !!apis.football_ok, detail: apis.football_msg || "" },
    { name: "Telegram", ok: !!apis.telegram_ok, detail: apis.telegram_msg || "" },
  ];

  const labels = (resumen.series_labels || []).slice(-12);
  const serieVIP = (resumen.series_vip || []).slice(-12);
  const serieFREE = (resumen.series_free || []).slice(-12);

  const picksRows = picksRecientes.slice(0, 15).map((p) => `
    <tr class="border-b last:border-0">
      <td class="px-3 py-2 text-sm">${esc(p.timestamp || "—")}</td>
      <td class="px-3 py-2 text-sm">${esc(p.liga || "—")}</td>
      <td class="px-3 py-2 text-sm">${esc(p.evento || "—")}</td>
      <td class="px-3 py-2 text-sm">${esc(p.tipo_pick || "—")}</td>
      <td class="px-3 py-2 text-sm">${p.ev != null ? Number(p.ev).toFixed(1) + "%" : "—"}</td>
      <td class="px-3 py-2 text-sm">${p.probabilidad != null ? Number(p.probabilidad).toFixed(0) + "%" : "—"}</td>
    </tr>`
  ).join("");

  const errRows = (erroresRecientes || []).slice(0, 10).map((e) => `
    <tr class="border-b last:border-0">
      <td class="px-3 py-2 text-sm">${esc(e.when || "—")}</td>
      <td class="px-3 py-2 text-sm">${esc(e.source || "sistema")}</td>
      <td class="px-3 py-2 text-sm">${esc(e.message || "—")}</td>
    </tr>`
  ).join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>PunterX · Diagnóstico</title>
  <!-- Tailwind Play CDN -->
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <!-- Chart.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-slate-50 text-slate-900">
  <div class="mx-auto max-w-7xl px-4 py-8">
    <header class="mb-8 flex items-center justify-between">
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight">Diagnóstico · PunterX</h1>
      <div class="text-sm text-slate-500">Actualizado: ${esc(at || "—")}</div>
    </header>

    <!-- CARDS -->
    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      ${cards.map(c => `
        <div class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
          <div class="text-sm text-slate-500">${esc(c.name)}</div>
          <div class="mt-1 text-2xl font-semibold">${esc(c.value)}</div>
        </div>`).join("")}
    </section>

    <!-- ESTADOS DE APIS -->
    <section class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4 mb-8">
      <h2 class="text-lg font-semibold mb-3">Estado de Integraciones</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${apiRows.map(r => `
          <div class="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
            <div>
              <div class="font-medium">${esc(r.name)}</div>
              <div class="text-xs text-slate-500">${esc(r.detail)}</div>
            </div>
            <div>${badge(r.ok)}</div>
          </div>`).join("")}
      </div>
    </section>

    <!-- CHARTS -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <div class="lg:col-span-2 rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Actividad (últimos ciclos)</h2>
        <div class="h-[300px]">
          <canvas id="chart-actividad" height="120"></canvas>
        </div>
      </div>
      <div class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Meta</h2>
        <ul class="text-sm list-disc pl-5 space-y-1 text-slate-600">
          <li>VIP ≥ 15% EV, Free 10–14.9% EV</li>
          <li>Prob IA 5–85%, gap ≤ 15 p.p.</li>
          <li>Top‑3 bookies y mejor cuota usada</li>
          <li>Anti-duplicado por evento/torneo</li>
        </ul>
      </div>
    </section>

    <!-- TABLAS -->
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Últimos picks</h2>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-slate-700">
            <thead class="text-xs uppercase text-slate-500">
              <tr>
                <th class="px-3 py-2">Fecha</th>
                <th class="px-3 py-2">Liga</th>
                <th class="px-3 py-2">Evento</th>
                <th class="px-3 py-2">Tipo</th>
                <th class="px-3 py-2">EV</th>
                <th class="px-3 py-2">Prob.</th>
              </tr>
            </thead>
            <tbody>${picksRows || ""}</tbody>
          </table>
        </div>
      </div>
      <div class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-4">
        <h2 class="text-lg font-semibold mb-3">Errores recientes</h2>
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-slate-700">
            <thead class="text-xs uppercase text-slate-500">
              <tr>
                <th class="px-3 py-2">Fecha</th>
                <th class="px-3 py-2">Fuente</th>
                <th class="px-3 py-2">Mensaje</th>
              </tr>
            </thead>
            <tbody>${errRows || ""}</tbody>
          </table>
        </div>
      </div>
    </section>

    <footer class="mt-10 text-center text-xs text-slate-400">
      Render ${ciclo_ms != null ? `${kfmt(ciclo_ms)} ms` : ""} · PunterX © ${new Date().getFullYear()}
    </footer>
  </div>
  <script>
    (function(){
      const ctx = document.getElementById('chart-actividad');
      if(!ctx) return;
      const labels = ${JSON.stringify(labels)};
      const vip = ${JSON.stringify(serieVIP)};
      const free = ${JSON.stringify(serieFREE)};
      new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'VIP', data: vip, tension: .35, borderWidth: 2 },
            { label: 'FREE', data: free, tension: .35, borderWidth: 2 }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    })();
  </script>
</body>
</html>`;
}

/* ============================================================
 *  FALLBACK MÍNIMO (si no hay core)
 * ============================================================ */
async function fallbackBuildDiagnostic() {
  // No golpeamos APIs: solo reportamos disponibilidad de ENV y plantillas vacías.
  const at = new Date().toISOString();
  const apis = {
    supabase_ok: !!(SUPABASE_URL && SUPABASE_KEY),
    supabase_msg: SUPABASE_URL ? "Credenciales detectadas" : "Faltan variables",
    openai_ok: !!OPENAI_API_KEY,
    openai_msg: OPENAI_API_KEY ? "API key presente" : "OPENAI_API_KEY ausente",
    odds_ok: !!ODDS_API_KEY,
    odds_msg: ODDS_API_KEY ? "API key presente" : "ODDS_API_KEY ausente",
    football_ok: !!API_FOOTBALL_KEY,
    football_msg: API_FOOTBALL_KEY ? "API key presente" : "API_FOOTBALL_KEY ausente",
    telegram_ok: !!TELEGRAM_BOT_TOKEN,
    telegram_msg: TELEGRAM_BOT_TOKEN ? "Bot token presente" : "TELEGRAM_BOT_TOKEN ausente",
  };

  return {
    ok: true,
    at,
    ciclo_ms: 0,
    resumen: {
      ejecuciones_hoy: 0,
      vip: 0,
      free: 0,
      series_labels: [],
      series_vip: [],
      series_free: [],
    },
    apis,
    picksRecientes: [],
    erroresRecientes: [],
    oai_cost_usd: null,
  };
}

/* ============================================================
 *  HANDLER (Netlify)
 * ============================================================ */
exports.handler = async (event) => {
  try {
    const params = event && event.queryStringParameters ? event.queryStringParameters : {};
    const asJSON = params.json === "1" || params.json === "true";

    // Usa core si existe, de lo contrario fallback mínimo
    let payload = null;
    if (core && typeof core.construirDiagnosticoCompleto === "function") {
      // core debe encargarse de chequear Supabase, OpenAI, OddsAPI, API‑FOOTBALL y Telegram,
      // y de armar: { ok, at, ciclo_ms, resumen{...series}, apis{...}, picksRecientes, erroresRecientes, oai_cost_usd? }
      payload = await core.construirDiagnosticoCompleto();
    } else {
      payload = await fallbackBuildDiagnostic();
    }

    if (asJSON) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      };
    }

    // HTML bonito por defecto
    const html = renderDashboardHTML(payload);
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error("[DIAG] error:", msg);
    // Nunca 500: devolvemos JSON de error amigable
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: msg }),
    };
  }
};
