# PunterX-Config.md
**Versión:** 2025-08-17  
**Responsables:** Luis Sánchez (owner) · Dev Senior PunterX  
**Ámbito:** Fútbol (soccer) global — pre-match y outrights. *Live* preparado pero **en pausa** por costos.

---

## 1) Propósito y principio rector
**Objetivo:** detectar y publicar **picks de alto EV** en **todos** los partidos apostables (sin whitelists), con enriquecimiento de **API-FOOTBALL PRO**, validaciones estrictas y guardrails de IA.  
**Principios clave:**
- **Cobertura 100% general**: sin ligas/IDs ni regiones hardcodeadas.
- **Ventana principal**: **45–55 min** antes del kickoff (fallback **35–70** si aplica).
- **STRICT_MATCH=1**: si OddsAPI y API-FOOTBALL no cuadran, **no se publica**.

---

## 2) Estado actual del repo (este .zip)
- ⚠️ **Pendiente de aplicar** varias mejoras acordadas:
  - Parametrización de **regiones** y **sport key** en OddsAPI (se ven hardcodes y `...` en URLs).
  - **Logger central** y **logs enriquecidos** (no están integrados).
  - **Arreglo de Telegram** (FREE/VIP) con `fetchWithRetry` (bloque roto).
  - Limpieza de `...` en `netlify.toml` y workflows YAML.
  - Unificación de `parse_mode` en **HTML**.
- ✅ Mantiene lógica base (ventanas / IA / guardrails / STRICT_MATCH ya descarta).
- ✅ Diagnóstico total (HTML + JSON) existente — UI propia en `diagnostico-total.js`.

> Este documento incluye **anclas exactas** para aplicar los cambios cuando indiques.

---

## 3) Arquitectura
**Netlify Functions (CommonJS, Node 20)**
- `autopick-vip-nuevo.cjs` → **pre-match** orquestador.
- `autopick-outrights.cjs` → outrights (reglas espejo).
- `autopick-live.cjs` → live (pausado).
- `_lib/af-resolver.cjs`, `_lib/match-helper.cjs`, `_lib/match-normalizer.cjs` → matching AF/OddsAPI.
- `_supabase-client.cjs`, `_telemetry.cjs`, `_corazonada.cjs`.
- `send.js` → Telegram (canal/VIP).
- `diagnostico-total.js` → panel y JSON.

**Fuentes**
- **OddsAPI** `/v4/sports/:sport/odds` (mercados: `h2h,totals,spreads`; odds `decimal`).
- **API-FOOTBALL PRO** v3: fixtures, alineaciones, árbitro, clima, forma, xG, lesiones, historial.
- **OpenAI GPT-5** → 1 JSON por evento (1 llamada con fallback corto).

**Supabase**
- `picks_historicos`, `odds_snapshots`, `px_locks`, `diagnostico_estado`, `diagnostico_ejecuciones` (+memoria IA).

---

## 4) Flujo maestro (pre-match)
1) **OddsAPI**: obtener eventos con cuotas (regiones **por ENV**).
2) **Ventanas**: principal **45–55**; fallback **35–70** (sin saltar STRICT_MATCH).
3) **Matching AF** (general): país/liga/equipos/fecha → si no cuadra y `STRICT_MATCH=1` → **descartar**.
4) **Prompt IA**: sólo **opciones reales** de OddsAPI + contexto AF (alineaciones, lesiones, clima, árbitro, forma, xG, historial) + memoria IA compacta.
5) **OpenAI**: 1 llamada (fallback) → JSON: `apuesta`, `probabilidad`, `analisis_free`, `analisis_vip`, `apuestas_extra`, `no_pick`, frases, etc.
6) **Validaciones** (ver §10): rango prob., coherencia con implícita, EV mínimo, outcome válido, Top-3 coherente.
7) **Clasificación por EV** → FREE (10–14.9) / VIP (≥15) por niveles.
8) **Telegram** (formatos aprobados).
9) **Supabase** (guardar + snapshots odds + memoria IA).
10) **Telemetría** (locks, contadores, causas).

---

## 5) Ventanas y tiempos
- **Principal:** 45–55 min.
- **Fallback:** 35–70 min.
- **Cron:** cada 15 min (Netlify).
- **TZ:** `America/Mexico_City`.

---

## 6) IA y guardrails
- 1 llamada por partido (con reintento corto).
- `no_pick=true` → **corta**.
- **Prob. IA** en [5%, 85%].
- **Coherencia** |P(IA) − P(implícita)| ≤ 15 p.p.
- **Apuesta válida**: debe existir outcome real y **cuota exacta**.
- **Top-3 bookies**: orden correcto; mejor **en negritas** (VIP).
- **Corazonada IA**: señal cualitativa (pesos por disponibilidad/contexto/mercado/xG).

---

## 7) EV y niveles
- **VIP**: EV ≥ 15
  - 🟣 Ultra Élite ≥ 40
  - 🎯 Élite Mundial 30–39.9
  - 🥈 Avanzado 20–29.9
  - 🥉 Competitivo 15–19.9
- **FREE**: 10–14.9 (informativo).
- **No guardar** EV < 10 ni picks incompletos.

---

## 8) Formatos Telegram
**Canal (@punterxpicks)**
- 📡 RADAR DE VALOR · liga (con país), “Comienza en X minutos aprox”, análisis breve, frase motivacional, CTA VIP, disclaimer.

**VIP (-1002861902996)**
- 🎯 PICK NIVEL [Ultra/Élite/Avanzado/Competitivo] · liga (con país), hora, EV y prob., **apuesta sugerida** + **apuestas extra** (O2.5, BTTS, Doble Oportunidad, Goleador, Marcador exacto, HT result, Hándicap asiático), **Top-3** (mejor en **negritas**), **datos avanzados** (clima/árbitro/lesiones/historial/xG), **corazonada IA**, disclaimer.  
- Frase final: **“🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.”**

---

## 9) Variables de entorno (Netlify)
**Presentes en tu panel (según nos pasaste):**  
`API_FOOTBALL_KEY, AUTH_CODE, AWS_LAMBDA_JS_RUNTIME, CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG, ENABLE_OUTRIGHTS, ENABLE_OUTRIGHTS_INFO, LIVE_COOLDOWN_MIN, LIVE_MARKETS, LIVE_MIN_BOOKIES, LIVE_POLL_MS, LIVE_PREFILTER_GAP_PP, LIVE_REGIONS, MATCH_RESOLVE_CONFIDENCE, MAX_OAI_CALLS_PER_CYCLE, NODE_OPTIONS, NODE_VERSION, ODDS_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK, OUTRIGHTS_COHERENCE_MAX_PP, OUTRIGHTS_EV_MIN_VIP, OUTRIGHTS_EXCLUDE, OUTRIGHTS_MIN_BOOKIES, OUTRIGHTS_MIN_OUTCOMES, OUTRIGHTS_PROB_MAX, OUTRIGHTS_PROB_MIN, PANEL_ENDPOINT, PUNTERX_SECRET, RUN_WINDOW_MS, SUB_MAIN_MAX, SUB_MAIN_MIN, SUPABASE_KEY, SUPABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID, TZ, WINDOW_FALLBACK_MAX, WINDOW_FALLBACK_MIN, WINDOW_FB_MAX, WINDOW_FB_MIN, WINDOW_MAIN_MAX, WINDOW_MAIN_MIN, WINDOW_MAX, WINDOW_MIN`.

**Recomendadas (pendientes de uso real en el repo):**
- `ODDS_REGIONS=us,uk,eu,au`  ← para cobertura global (reemplazar hardcodes).
- `ODDS_SPORT_KEY=soccer`      ← para `/v4/sports/:sport/odds` (evita “sportKey is not defined”).
- `LOG_VERBOSE=1|0` y `LOG_EVENTS_LIMIT=8` ← logging enriquecido.

---

## 10) Reglas de validación y guardado
1. `no_pick` → descartar.  
2. **Integridad:** `apuesta`, `probabilidad`, `analisis_free`, `analisis_vip`.  
3. **Outcome válido** + **cuota exacta** (OddsAPI).  
4. **Prob. IA** [5, 85].  
5. **Coherencia** ≤ 15 p.p.  
6. **EV ≥ 10** para guardar; **VIP** si **EV ≥ 15**.  
7. **Anti-duplicado** por `evento` (pre-match) / `torneo` (outrights).  
8. **Top-3 bookies** adjunto (`top3_json`).

---

## 11) Anti-duplicado y locks
- Duplicado por `evento` (pre-match) y por **torneo** (outrights).
- Lock distribuido `px_locks` con TTL para evitar envíos simultáneos.

---

## 12) Supabase (esquema recomendado)
**`picks_historicos`**
- `evento` (text), `analisis` (text), `apuesta` (text), `tipo_pick` ('VIP'/'FREE'), `liga` (text), `equipos` (text), `ev` (numeric), `probabilidad` (numeric), `nivel` (text), `timestamp` (timestamptz), `top3_json` (jsonb).
```sql
alter table if exists public.picks_historicos
  add column if not exists top3_json jsonb;
Otros: odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones, tablas de memoria IA.

13) Corazonada IA
Flags/pesos: CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG.

Inputs: alineaciones/lesiones, forma/historial, señales de mercado (snapshots), xG.

Salida: texto breve (+ score interno opcional).

14) Outrights
Sin listas fijas; resolver AF por texto/season.

Validaciones espejo: outcome real, prob. IA [5–85], coherencia ≤ 15 p.p., EV ≥ OUTRIGHTS_EV_MIN_VIP para VIP.

Anti-duplicado por torneo; Top-3 si aplica.

15) Live (pausado)
Motivo: consumo alto de llamadas a OddsAPI desde Replit.

Estado: código funcional, pero regiones hardcodeadas (ver §17.2).

Reactivación futura: subir plan + rate-limit.

16) Diagnóstico y observabilidad
diagnostico-total.js → UI HTML (Tailwind/Chart.js) + salida JSON si ?json=1|true.

Métricas clave: consultas, candidatos, IA OK/fallback, FREE/VIP, causas de descarte, guardados, enviados, duración de ciclo, estado APIs, locks.

17) Acciones pendientes (con anclas exactas para aplicar)
17.1 autopick-vip-nuevo.cjs
Telegram (FREE/VIP) roto
Anclas:

php
Copiar
Editar
async function enviarFREE(text) { ... fetchWithRetry(url, { method:'POST', heade...json' }, body: JSON.stringify(body) }, { retries:2, base:600 }); }
async function enviarVIP(text)  { ... fetchWithRetry(url, { method:'POST', heade...json' }, body: JSON.stringify(body) }, { retries:2, base:600 }); }
Reemplazar por:

js
Copiar
Editar
const res = await fetchWithRetry(
  url,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  { retries: 2, base: 600 }
);
OddsAPI URL con ... y regiones hardcodeadas
Ancla:

javascript
Copiar
Editar
const base = `https://api.the-odds-api.com/v4/sports/soccer/...regions=eu,us,uk&oddsFormat=decimal&markets=h2h,totals,spreads`;
const url  = `${base}&apiKey=${encodeURIComponent(ODDS_API_KEY)}`;
Reemplazar por (concatenación segura + ENV):

js
Copiar
Editar
const SPORT = process.env.ODDS_SPORT_KEY || 'soccer';
const REGIONS = process.env.ODDS_REGIONS || process.env.LIVE_REGIONS || 'us,uk,eu,au';
const base = 'https://api.the-odds-api.com/v4/sports/' + encodeURIComponent(SPORT) + '/odds';
const url =
  base +
  '?apiKey=' + encodeURIComponent(ODDS_API_KEY) +
  '&regions=' + encodeURIComponent(REGIONS) +
  '&oddsFormat=decimal' +
  '&markets=h2h,totals,spreads';
Logs enriquecidos (logger + causas + próximos partidos)

Importar logger justo debajo de:

javascript
Copiar
Editar
const { computeCorazonada } = require('./_corazonada.cjs');
Agregar:

js
Copiar
Editar
const { createLogger } = require('./_logger.cjs');
ENV de logs debajo de:

arduino
Copiar
Editar
const DEBUG_TRACE  = process.env.DEBUG_TRACE === '1';
Agregar:

js
Copiar
Editar
const LOG_VERBOSE = process.env.LOG_VERBOSE === '1';
const LOG_EVENTS_LIMIT = Number(process.env.LOG_EVENTS_LIMIT || '8');
Crear logger debajo de:

javascript
Copiar
Editar
const CICLO_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
console.log(`▶️ CICLO ${CICLO_ID} start; now(UTC)= ${new Date().toISOString()}`);
Agregar:

js
Copiar
Editar
const logger = createLogger(`CICLO:${CICLO_ID}`);
logger.section('CICLO PunterX');
logger.info('▶️ Inicio ciclo; now(UTC)=', new Date().toISOString());
Objeto causas debajo de const resumen = { ... }:

js
Copiar
Editar
const causas = { strict_mismatch:0, no_pick_flag:0, outcome_invalido:0, prob_fuera_rango:0, incoherencia_pp:0, ev_insuficiente:0, ventana_fuera:0, duplicado:0, otros:0 };
global.__px_causas = causas;
Próximos partidos (mins) debajo de:

javascript
Copiar
Editar
console.log(`ODDSAPI ok=true count=${resumen.recibidos} ms=${tOddsMs}`);
Agregar:

js
Copiar
Editar
if (LOG_VERBOSE) {
  const near = (Array.isArray(eventos) ? eventos : [])
    .map(ev => {
      const t = Date.parse(ev.commence_time || (ev.fixture && ev.fixture.date) || ev.start_time);
      const mins = Math.round((t - Date.now()) / 60000);
      const home = ev.home_team || (ev.teams && ev.teams.home && ev.teams.home.name) || ev.home || '—';
      const away = ev.away_team || (ev.teams && ev.teams.away && ev.teams.away.name) || ev.away || '—';
      return { mins, label: `${home} vs ${away}` };
    })
    .filter(x => Number.isFinite(x.mins))
    .sort((a, b) => a.mins - b.mins)
    .slice(0, LOG_EVENTS_LIMIT);
  logger.section('Próximos eventos (mins)');
  near.forEach(n => logger.info(`⏱️ ${n.mins}m → ${n.label}`));
}
Contar causas en tus descartes (anclas exactas presentes en tu archivo):

no_pick:
Ancla:

javascript
Copiar
Editar
if (esNoPick(pick)) { console.log(traceId, '🛑 no_pick=true →', ...); continue; }
Reemplazar por:

js
Copiar
Editar
if (esNoPick(pick)) {
  causas.no_pick_flag++;
  console.log(traceId, '🛑 no_pick=true →', pick?.motivo_no_pick || 's/d');
  continue;
}
Outcome/cuota no encontrada:
Ancla:

javascript
Copiar
Editar
if (!cuotaSel || !cuotaSel.valor) { console.warn(traceId
Reemplazar por:

js
Copiar
Editar
if (!cuotaSel || !cuotaSel.valor) {
  causas.outcome_invalido++;
  console.warn(traceId, 'No se encontró cuota del mercado solicitado → descartando');
  continue;
}
Prob. fuera de rango:
Ancla:

javascript
Copiar
Editar
if (probPct < 5 || probPct > 85) { console.warn(...); continue; }
Reemplazar por:

js
Copiar
Editar
if (probPct < 5 || probPct > 85) {
  causas.prob_fuera_rango++;
  console.warn(traceId, 'Probabilidad fuera de rango [5–85] → descartando');
  continue;
}
Incoherencia > 15 p.p.:
Ancla:

javascript
Copiar
Editar
if (imp != null && Math.abs(probPct - imp) > 15) {
Reemplazar por:

js
Copiar
Editar
if (imp != null && Math.abs(probPct - imp) > 15) {
  causas.incoherencia_pp++;
  console.warn(traceId, `❌ Probabilidad inconsistente (model=${probPct}%, implícita=${imp}%) → descartando`);
  continue;
}
EV < 10:
Ancla exacta:

javascript
Copiar
Editar
if (ev < 10) { resumen.descartados_ev++; console.log(traceId, `EV ${ev}% < 10% → descartado`); continue; }
Reemplazar por:

js
Copiar
Editar
if (ev < 10) {
  causas.ev_insuficiente++;
  resumen.descartados_ev++;
  console.log(traceId, `EV ${ev}% < 10% → descartado`);
  continue;
}
Fuera de ventana:
Ancla actual:

javascript
Copiar
Editar
// Filtrar por ventana
const inWindow = partidos.filter(p => {
  const mins = Math.round(p.minutosFaltantes);
  const principal = mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX;
  const fallback  = !principal && mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX;
  return principal || fallback;
});
Reemplazar por:

js
Copiar
Editar
const inWindow = partidos.filter(p => {
  const mins = Math.round(p.minutosFaltantes);
  const principal = mins >= WINDOW_MAIN_MIN && mins <= WINDOW_MAIN_MAX;
  const fallback  = !principal && mins >= WINDOW_FB_MIN && mins <= WINDOW_FB_MAX;
  const dentro = principal || fallback;
  if (!dentro) causas.ventana_fuera++;
  return dentro;
});
Resumen final con causas (al final del ciclo):
Anclas a reemplazar (2 líneas):

javascript
Copiar
Editar
console.log(`🏁 Resumen ciclo: ${JSON.stringify(resumen)}`);
console.log(`Duration: ${(Date.now()-started)...
Reemplazar por:

js
Copiar
Editar
logger.section('Resumen ciclo');
logger.info('Conteos:', JSON.stringify(resumen));
logger.info('Causas de descarte:', JSON.stringify(causas));
const topCausas = Object.entries(causas).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}:${v}`).join(' | ');
logger.info('Top causas:', topCausas || 'sin descartes');

// (opcional) mantener los logs antiguos:
console.log(`🏁 Resumen ciclo: ${JSON.stringify(resumen)}`);
console.log(`Duration: ${(Date.now()-started).toFixed(2)} ms...Memory Usage: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
17.2 autopick-live.cjs
Ancla exacta (hardcode):

ini
Copiar
Editar
LIVE_REGIONS = "uk",
Reemplazar por:

js
Copiar
Editar
const LIVE_REGIONS = process.env.LIVE_REGIONS || process.env.ODDS_REGIONS || 'us,uk,eu,au';
Y en cada URL, usar:

js
Copiar
Editar
'&regions=' + encodeURIComponent(LIVE_REGIONS)
17.3 autopick-outrights.cjs
Ancla exacta:

javascript
Copiar
Editar
const REGIONS = "eu,uk,us";
...
&regions=${encodeURIComponent(REGIONS)}
Reemplazar por:

js
Copiar
Editar
const REGIONS = process.env.ODDS_REGIONS || 'us,uk,eu,au';
...
&regions=${encodeURIComponent(REGIONS)}
17.4 send.js
Anclas:

vbnet
Copiar
Editar
parse_mode: "Markdown"
Reemplazar por:

js
Copiar
Editar
parse_mode: "HTML"
17.5 netlify.toml
Eliminar la línea con ... bajo [functions].

17.6 Workflows (.github/workflows/*.yml)
Eliminar todas las líneas ... (rompen YAML).

18) Roadmap inmediato
Aplicar las sustituciones de §17 (son copy/paste con anclas exactas).

Re-deploy en Netlify → verificar logs enriquecidos y diagnóstico.

Activar logs extra en ENV: LOG_VERBOSE=1, LOG_EVENTS_LIMIT=8.

Unificar parse_mode a HTML en todos los flujos.

Cuando haya presupuesto: reactivar Live con RATE-LIMIT.

19) secrets.env.example (plantilla)
env
Copiar
Editar
ODDS_API_KEY=
API_FOOTBALL_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
OPENAI_MODEL_FALLBACK=gpt-4o-mini

SUPABASE_URL=
SUPABASE_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
TELEGRAM_GROUP_ID=

PANEL_ENDPOINT=
PUNTERX_SECRET=

TZ=America/Mexico_City
WINDOW_MAIN_MIN=45
WINDOW_MAIN_MAX=55
WINDOW_FALLBACK_MIN=35
WINDOW_FALLBACK_MAX=70

ODDS_REGIONS=us,uk,eu,au
ODDS_SPORT_KEY=soccer
LIVE_REGIONS=us,uk,eu,au

STRICT_MATCH=1
MAX_OAI_CALLS_PER_CYCLE=20

LOG_VERBOSE=0
LOG_EVENTS_LIMIT=8

CORAZONADA_ENABLED=1
CORAZONADA_W_AVAIL=0.25
CORAZONADA_W_CTX=0.25
CORAZONADA_W_MARKET=0.25
CORAZONADA_W_XG=0.25
20) Errores comunes y su estado
Telegram FREE/VIP roto → Pendiente de fix (ver §17.1).

OddsAPI URL con ... y regiones fijas → Pendiente de fix (ver §17.1).

LIVE_REGIONS hardcode → Pendiente (ver §17.2).

Outrights REGIONS hardcode → Pendiente (ver §17.3).

parse_mode Markdown → Pendiente (ver §17.4).

netlify.toml con ... → Pendiente (ver §17.5).

Workflows con ... → Pendiente (ver §17.6).

STRICT_MATCH → Activo (descarta si AF no cuadra).
