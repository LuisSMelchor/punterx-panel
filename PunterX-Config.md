📄 PunterX — Configuración y Estado Actual (actualizado al 17-ago-2025)

Propósito: mantener continuidad total del proyecto y servir como fuente de verdad para arquitectura, flujos, ventanas, EV, niveles, APIs, crons, plantillas de Telegram, Supabase y memoria IA.
Regla: cualquier cambio en código, variables o lógica debe reflejarse aquí y en prompts_punterx.md.

0) Resumen ejecutivo

Runtime: Netlify Functions · Node 20 · CommonJS (sin ESM ni top-level await).

Flujos:
PRE-MATCH (principal 40–55 min; fallback 35–70 min), LIVE (in-play) y OUTRIGHTS.
Orden PRE: OddsAPI → API-FOOTBALL → OpenAI → EV → Clasificación FREE/VIP → Telegram → Supabase → Memoria IA.

EV: EV% = (p · (o − 1) − (1 − p)) · 100.
Cortes: FREE 10–14.9%, VIP ≥15% con subniveles: 🥉 15–19.9%, 🥈 20–29.9%, 🎯 30–39.9%, 🟣 ≥40%.

Validaciones IA: no_pick, probabilidad ∈ [5%, 85%], coherencia con probabilidad implícita ≤ 15 p.p., apuesta ∈ opciones válidas, Top-3 bookies correcto.

Mensajería Telegram: formatos aprobados FREE y VIP, país antes de liga, mejor cuota en negritas.

Supabase: tabla picks_historicos con anti-duplicado (evento en PRE; torneo en OUTRIGHTS; bucket 5’ en LIVE); no guardar EV < 10% o datos incompletos.

Diagnóstico y logs: instrumentación de ventana, contadores, soft budget, y meta de OpenAI (finish_reason/usage).

Cambios recientes claves:

Ventana mantenida en 40–55 min (principal) por criterio operativo de alineaciones confirmadas; fallback 35–70.

Bug LIVE corregido (party.pickPoint → partido.pickPoint).

OpenAI: manejo de finish_reason="length" con reintento y ajuste de tokens; fallback de modelo.

Resolver AF por liga+fecha + fallbacks (search, teams→IDs, h2h±2d) y normalizador avanzado.

Logs: métricas principal, fallback, af_hits, af_fails en resumen.

netlify.toml: unificación de bloques [functions] (evita error “Can’t redefine existing key”).

1) Arquitectura
1.1 Componentes

OddsAPI (v4): cuotas en tiempo real (mercados h2h, totals, spreads), regiones eu,us,uk, formato decimal.

API-FOOTBALL PRO (v3): fixtures, árbitro, venue/ciudad, clima (si aplica), forma/h2h, lesiones (si se consulta).

OpenAI (GPT-5): análisis JSON por evento según plantilla en prompts_punterx.md (sección Pre-match).

Supabase: picks_historicos, diagnostico_estado, diagnostico_ejecuciones.

Telegram: canal FREE y grupo VIP (enviar con parse_mode: HTML y disable_web_page_preview: true).

Memoria IA: recuperación de últimos picks relevantes por liga/equipos para contexto del prompt.

1.2 Repos y despliegue

Netlify: crons para PRE/OUTRIGHTS; Node 20; bundling con esbuild; included_files para _lib/** y prompts_punterx.md.

Replit (opcional): soporte a LIVE si se usa flujo separado.

CommonJS en todo: require(...) y module.exports = { ... }.

2) Flujos
2.1 PRE-MATCH

Ventanas:

Principal: 40–55 min antes del kickoff (criterio operativo: captar alineaciones confirmadas o inminentes).

Fallback: 35–70 min (solo si no cae en principal).

Exclusión: eventos ya iniciados (mins < 0).

Pipeline:

OddsAPI → filtra no iniciados y por ventana; normaliza evento.

Resolver de nombres/ligas (normalizador, alias, match score).

API-FOOTBALL (estrategia en cascada):

fixtures?date=YYYY-MM-DD&league={id}&timezone=UTC (mapa AF_LEAGUE_ID_BY_TITLE),

luego fixtures?league={id}&from=...&to=...,

luego fixtures?search=HOME AWAY (y por equipo),

y por último teams?search= → IDs → fixtures?h2h=th-ta&from&to.

Prompt (plantilla MD cacheada; CONTEXT_JSON + OPCIONES_APOSTABLES_LIST).

OpenAI: un disparo + manejo de length (reintento con más tokens) + fallback de modelo.

Validaciones (apuesta ∈ opciones, prob. ∈ [5,85], coherencia ≤ 15 p.p., mercado/label correcto).

EV y clasificación FREE/VIP; formato Telegram y envío.

Supabase: guardar si EV ≥ 10% y datos completos (anti-duplicado por evento).

Memoria: alimentar/consultar últimos picks relevantes.

Contadores de resumen: recibidos, enVentana, principal, fallback, candidatos, procesados, descartados_ev, enviados_vip, enviados_free, intentos_vip, intentos_free, guardados_ok, guardados_fail, oai_calls, af_hits, af_fails.

2.2 LIVE (in-play)

Prefiltro por mercados activos y min/max de juego (si aplica).

Bucket 5’ para anti-duplicado por fixture + bucket.

Mensajería con edición/pinned opcional (VIP).

Guardado con campos LIVE (ver esquema).

2.3 OUTRIGHTS

Mismo marco de validación y EV; anti-duplicado por torneo.

Manejo de finish_reason="length" aún pendiente de endurecer (ver “Errores y fixes en curso”).

3) Reglas de guardado

No guardar picks con EV < 10% o con datos incompletos.

Anti-duplicado:

PRE por evento (“HOME vs AWAY (LIGA)”),

OUTRIGHTS por torneo,

LIVE por fixture_id + bucket 5’.

Validar:

apuesta pertenece a opciones apostables mostradas,

probabilidad ∈ [5%, 85%],

|prob_modelo − prob_implícita| ≤ 15 p.p.,

Top-3 bookies bien calculado y mejor cuota en negritas en el mensaje VIP.

Campos mínimos para guardar: evento, analisis, apuesta, tipo_pick (FREE|VIP|LIVE|OUTRIGHT), liga, equipos, ev, probabilidad, nivel, timestamp.

Campos extra (si se tienen): pais, top3_json, y LIVE: is_live, kickoff_at, minute_at_pick, phase, score_at_pick, market_point, vigencia_text.

4) Telegram — formatos
4.1 FREE (canal)

Encabezado: 📡 RADAR DE VALOR

Liga con país: 🏆 {🇲🇽/flag} {PAÍS} - {LIGA}

Match: ⚔️ HOME vs AWAY

Tiempo: ⏱️ Comienza en X min aprox

Análisis breve IA + frase motivacional

CTA: “Únete al VIP…”

Disclaimer: responsabilidad.

4.2 VIP (grupo)

Encabezado con nivel: 🎯 PICK NIVEL: {🟣/🎯/🥈/🥉} {Nivel}

Liga con país; hora relativa

Análisis VIP

EV y probabilidad + momio americano + cuota usada

Apuesta sugerida + Apuestas extra (bullets)

Top-3 bookies (mejor en negritas)

Datos avanzados: clima/árbitro/estadio/ciudad

Tagline + Disclaimer

5) Ventanas y tiempo

Netlify corre en UTC. Todos los cálculos de tiempo usan ISO/UTC.

mins = round(commence_time − nowUTC) / 60.

Filtros exactos:

Principal: mins ∈ [40, 55]

Fallback: mins ∈ [35, 70] y no principal.

Mensajes en display: Comienza en X min aprox.

Nota: Elegimos 40–55 min como principal para equilibrar confirmación de alineaciones y oportunidad de mercado. El fallback cubre desfasajes. Si en el futuro se ajusta a 45–60, actualizar aquí y en envs.

6) Matching OddsAPI ↔ API-FOOTBALL

Normalización fuerte (sin tildes; remueve “fc/cf/sc/afc/club/deportivo/the/los/las/el/la/de/do/da/unam”, espacios, etc.).

Resolver con match score (Jaccard + boosts por igualdad/inclusión).

Estrategia de AF (cascada):

league_id + date (mapeo AF_LEAGUE_ID_BY_TITLE)

league + window ±2d

search=HOME AWAY y luego por cada equipo

teams?search= → fixtures?h2h=th-ta&from&to (±2d)

Log:

RESOLVE > home="X"→"X’" | away="Y"→"Y’" | liga="N/D"→"Liga"

Aviso si score bajo.

7) OpenAI — prompts y robustez

Plantilla: prompts_punterx.md (sección 1) Pre-match). Cacheada en memoria para el ciclo.

Payload:

Modelo primario: OPENAI_MODEL (por defecto gpt-5-mini).

Fallback: OPENAI_MODEL_FALLBACK (por defecto gpt-5).

Intento 1: max_completion_tokens ≈ 500–550.

Si finish_reason === "length" ⇒ reintento elevando tokens (actual: 650, recomendado 680) y retirando response_format si el provider lo exige.

Si sigue vacío ⇒ probar modelo fallback.

Respuesta: solo JSON; si malformado ⇒ reparador JSON con mini-prompt.

Límites por ciclo: MAX_OAI_CALLS_PER_CYCLE (actual 40).
Budget temporal: SOFT_BUDGET_MS (70s) para cortar el ciclo si se prolonga.

8) EV y niveles

Probabilidad del modelo (probabilidad) validada y convertida a % si viene en [0–1].

Prob. implícita: 100 / cuota (decimal).

Coherencia: |prob_modelo − prob_implícita| ≤ 15 p.p.

EV% = (p · (o − 1) − (1 − p)) · 100 (dos decimales).

Clasificación:

🟣 Ultra Élite ≥ 40

🎯 Élite Mundial 30–39.9

🥈 Avanzado 20–29.9

🥉 Competitivo 15–19.9

Informativo < 15 (no se envía VIP)

9) Supabase — tablas y anti-duplicado
9.1 picks_historicos (campos clave)

id (pk), evento, analisis, apuesta, tipo_pick (FREE|VIP|LIVE|OUTRIGHT),

liga, pais (opcional), equipos,

ev (num), probabilidad (num), nivel (texto),

timestamp (ISO),

top3_json (jsonb opcional),

LIVE extra: is_live (bool), kickoff_at (ISO), minute_at_pick (num), phase (text), score_at_pick (text), market_point (text), vigencia_text (text).

Reglas:

Anti-duplicado PRE por evento.

Anti-duplicado OUTRIGHTS por torneo (si aplica).

Anti-duplicado LIVE por fixture_id + bucket 5’.

No insertar si EV < 10 o faltan campos obligatorios.

Bug corregido: en LIVE party.pickPoint → partido.pickPoint.

10) Logs y diagnóstico

Inicio de ciclo: id corto + now(UTC)=....

Config de ventana: “40–55 | 35–70”.

OddsAPI: ok=true count=N ms=T.

Filtrado: “Filtrados X eventos ya comenzados (omitidos)”.

DBG por evento: commence_time= ... mins= ....

Filtrado ventana: Principal=K | Fallback=M | Total EN VENTANA=V | Eventos RECIBIDOS=R.

Resumen ciclo:
JSON con recibidos, enVentana, principal, fallback, candidatos, procesados, descartados_ev, enviados_vip, enviados_free, intentos_vip, intentos_free, guardados_ok, guardados_fail, oai_calls, af_hits, af_fails.

OpenAI meta: { model, ms, finish_reason, usage }.

Soft budget: corta el bucle si excede SOFT_BUDGET_MS.

11) Configuración (envs)

Obligatorias:

SUPABASE_URL, SUPABASE_KEY

OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK

ODDS_API_KEY, API_FOOTBALL_KEY

TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID

Operativas:

WINDOW_MAIN_MIN (40), WINDOW_MAIN_MAX (55)

WINDOW_FB_MIN (35), WINDOW_FB_MAX (70)

PREFILTER_MIN_BOOKIES (2)

MAX_CONCURRENCY (6) (no forzamos concurrencia alta en Netlify)

MAX_PER_CYCLE (50)

SOFT_BUDGET_MS (70000)

MAX_OAI_CALLS_PER_CYCLE (40)

COUNTRY_FLAG (por defecto 🇲🇽)

12) netlify.toml

Bloques únicos para evitar el error “Can’t redefine existing key at [functions]”.

node_bundler = "esbuild"; incluir _lib/** y prompts_punterx.md en included_files.

Crons cada 15 minutos (o el ritmo configurado) para PRE/OUTRIGHTS.

Timeouts definidos acorde a tiempo de llamadas a APIs y OpenAI.

Estado: consolidado a un solo [functions] y un solo [functions."*"]. Validado que compile.

13) Archivos clave

netlify/functions/autopick-vip-nuevo.cjs (PRE)

netlify/functions/autopick-outrights.cjs (Outrights)

netlify/functions/autopick-live.cjs (Live)

netlify/functions/send.js (plantillas Telegram — hoy embebidas en PRE)

_lib/af-resolver.cjs (resolver fixture)

_lib/match-helper.cjs (exporta resolveTeamsAndLeague)

_supabase-client.cjs (si se usa)

_diag-core-*.cjs (si existen)

diagnostico-total.js, memoria-inteligente.js, verificador-aciertos.js, analisis-semanal.js, check-status.js

prompts_punterx.md, PunterX-Config.md, netlify.toml, package.json, telegram_formatos.md, picks_historicos_schema.sql, secrets.env.example

14) Cambios recientes en código (resumen)

autopick-vip-nuevo.cjs

Ventana 40–55 (principal) y 35–70 (fallback) mantenida; logs separados principal/fallback.

Resolver previo a AF; AF en cascada (league+date → window±2d → search → teams→h2h).

OpenAI con reintento por length y fallback de modelo; reparador JSON.

LIVE bug corregido (market_point ahora usa partido.pickPoint).

Resumen con af_hits/af_fails y oai_calls.

Tagline y flag configurables, momio americano derivado de decimal.

netlify.toml

Unificación de [functions]; included_files completos; sin duplicados.

prompts_punterx.md

Se usa sección 1) Pre-match. Render con {{CONTEXT_JSON}} y {{OPCIONES_APOSTABLES_LIST}}.

Cache en memoria por ciclo.

15) Errores y fixes en curso

matchHelper.resolveTeamsAndLeague is not a function
Causa: exportación no coincide con el require.
Fix: garantizar en _lib/match-helper.cjs:

function resolveTeamsAndLeague(args) { /* ... */ }
module.exports = { resolveTeamsAndLeague };


y en el import usar const { resolveTeamsAndLeague } = require('./_lib/match-helper.cjs');
Estado: en proceso de verificación en logs.

OpenAI finish_reason="length" en PRE (se ve en logs)
Fix aplicado: reintento +150 tokens (actual 650) y retiro de response_format si falla.
Mejora sugerida: elevar techo a 680 en reintento para reducir truncados observados; mantener MAX_OAI_CALLS_PER_CYCLE=40 y SOFT_BUDGET_MS=70s para no disparar costos.
Estado: ajuste recomendado pendiente de commit si se aprueba.

Outrights/Live sin endurecimiento completo de length
Fix sugerido: portar el mismo patrón de PRE a autopick-outrights.cjs y autopick-live.cjs.
Estado: pendiente después de validar PRE estable.

Concurrencia / locks
Riesgo: múltiples invocaciones simultáneas en ventanas muy pobladas.
Mitigación actual: lock in-memory por invocación (global.__punterx_lock).
Mejora sugerida: lock en Supabase con TTL corto (fila locks con expires_at) para impedir solapes entre lambdas independientes.

16) Checklist de conformidad

Ventanas PRE 40–55 / 35–70: Sí

Excluir eventos iniciados (mins < 0): Sí

Matching AF con normalización + cascada: Sí

OpenAI una llamada + reintento por length + fallback: Sí (mejorar techo a 680)

Parser/repair JSON, no_pick, prob. ∈ [5–85], coherencia ≤ 15 p.p.: Sí

EV y niveles VIP: Sí

Telegram FREE/VIP con país, top-3 y mejor cuota en negritas: Sí

Supabase guardado, anti-duplicado, LIVE campos extra: Sí

Logs/diagnóstico, contadores y meta OAI: Sí

CommonJS (sin ESM; sin top-level await): Sí

netlify.toml sin duplicados [functions]: Sí

package.json scripts CJS: Sí

Envs completas y documentadas: Sí

17) Operación y pruebas
17.1 Casos estáticos A–E (UTC)

now = 2025-08-16T11:45:00Z

A: kick=12:25 → mins=40 ✓ principal

B: kick=12:40 → mins=55 ✓ principal

C: kick=12:20 → mins=35 ✓ fallback

D: kick=12:55 → mins=70 ✓ fallback

E: kick=11:30 → mins=-15 ✗ excluido

17.2 Métricas objetivo

Respuestas OAI truncadas: <5% tras elevar reintento a 680 tokens.

“Sin coincidencias AF”: ↓ ≥80% con resolver + cascada AF.

Eventos PRE fuera de ventana: <1% (logs de control).

18) Variables y secretos — secrets.env.example (ejemplo)
# Claves
SUPABASE_URL=""
SUPABASE_KEY=""
OPENAI_API_KEY=""
ODDS_API_KEY=""
API_FOOTBALL_KEY=""
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHANNEL_ID=""
TELEGRAM_GROUP_ID=""

# Modelos
OPENAI_MODEL="gpt-5-mini"
OPENAI_MODEL_FALLBACK="gpt-5"

# Ventanas
WINDOW_MAIN_MIN="40"
WINDOW_MAIN_MAX="55"
WINDOW_FB_MIN="35"
WINDOW_FB_MAX="70"

# Operativas
PREFILTER_MIN_BOOKIES="2"
MAX_CONCURRENCY="6"
MAX_PER_CYCLE="50"
SOFT_BUDGET_MS="70000"
MAX_OAI_CALLS_PER_CYCLE="40"
COUNTRY_FLAG="🇲🇽"

19) Consideraciones de “corazonada” (futuro)

No operativo aún. Idea: índice heurístico (Heuristic Confidence Index) con señales blandas (momentum de cuotas, patrones históricos cortos, dispersión de bookies, late line moves).

Integración propuesta: sumar +1/+2 puntos al score preliminar de candidatos; nunca sobrepasar validaciones IA/EV.

Medición: A/B por ventana temporal, comparar lift de EV y tasa de acierto; registrar hci_score en Supabase.

Requisito: no alterar guardrails (5–85%, ≤15 p.p., EV ≥ 10%).

20) Procedimiento de despliegue (resumen)

Actualiza .env/variables en Netlify.

Verifica netlify.toml (bloques únicos; included_files).

npm ci local; netlify deploy --build (o pipeline CI).

Revisa logs:

inicio de ciclo, ventana, filtrados, contadores, meta OAI, resumen.

si aparecen length frecuentes ⇒ subir techo de reintento a 680.

si aparece resolveTeamsAndLeague is not a function ⇒ corregir export en _lib/match-helper.cjs.

21) Apéndice SQL (idempotente)
-- picks_historicos (campos clave y LIVE extra)
create table if not exists picks_historicos (
  id bigserial primary key,
  evento text not null,
  analisis text not null,
  apuesta text not null,
  tipo_pick text not null check (tipo_pick in ('FREE','VIP','LIVE','OUTRIGHT')),
  liga text,
  pais text,
  equipos text,
  ev numeric,
  probabilidad numeric,
  nivel text,
  timestamp timestamptz default now(),
  top3_json jsonb,
  -- LIVE
  is_live boolean default false,
  kickoff_at timestamptz,
  minute_at_pick int,
  phase text,
  score_at_pick text,
  market_point text,
  vigencia_text text
);

-- índices útiles
create index if not exists idx_picks_evento on picks_historicos (evento);
create index if not exists idx_picks_tipo_timestamp on picks_historicos (tipo_pick, timestamp desc);
create index if not exists idx_picks_is_live on picks_historicos (is_live);

22) Fuente de verdad

Este documento y prompts_punterx.md son la referencia obligatoria para cualquier ajuste.

Si código y docs divergen, actualiza ambos inmediatamente y registra el cambio aquí.

Fin de PunterX-Config ✅
