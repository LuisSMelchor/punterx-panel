📄 PunterX — Configuración y Estado Actual (Actualizado)

Fecha: 17 de agosto de 2025
Estado: ✅ Deploy completado, logs instrumentados. ⏳ En espera de próximos ciclos para validar reducción total de “Sin coincidencias en API-FOOTBALL” y calidad de picks.

0) Resumen ejecutivo

PunterX es un sistema automatizado que detecta y publica picks de alto EV usando OddsAPI (cuotas), API-FOOTBALL PRO (datos de partido), OpenAI GPT-5 (análisis en JSON), Supabase (histórico/memoria) y Telegram (FREE/VIP).
El sistema ahora incluye:

Match Resolver propio (OddsAPI ↔ API-FOOTBALL) con normalización avanzada y scoring (Jaccard + boosts) para emparejar equipos/liga/fecha sin depender solo de search=.

Estrategia league_id+date como intento primario, con fallbacks robustos (search, teams, h2h ±2d).

Logs de trazabilidad en puntos críticos (ventana, resolver, enriquecimiento, OpenAI, guardado) para auditoría rápida.

Bandera y país en PRE y VIP, Top-3 ordenado (mejor en negritas), anti-duplicado LIVE por minute_bucket.

Presupuesto de IA por ciclo y retry ajustado cuando hay finish_reason: length.

1) Arquitectura (alto nivel)

Runtime: Netlify Functions (Node 20, CommonJS, esbuild)

Fuentes:

OddsAPI → cuotas pre/live (mercados h2h/totals/spreads)

API-FOOTBALL PRO → fixtures, minuto/estado, marcador, árbitro, clima

IA: OpenAI GPT-5 (primario) con GPT-5-mini (fallback) → JSON estructurado

Persistencia: Supabase (picks_historicos + tablas de diagnóstico opcionales)

Distribución: Telegram Bot API (FREE channel, VIP group)

Operación: Netlify Cron; loop local opcional para LIVE

Coherencia: CommonJS sin top-level await; formatos y reglas de EV consistentes

2) Archivos clave y módulos nuevos

netlify/functions/autopick-vip-nuevo.cjs — PRE-match (ventana principal 40–55; fallback 35–70)

✅ NUEVO: Logs finos (ventanas, contadores, modelo IA, EV, guardado, errores Telegram).

✅ NUEVO: Match Resolver previo al enriquecimiento con AF.

✅ NUEVO: Enriquecimiento por league_id+date y fallbacks (search, teams + fixtures?h2h).

✅ NUEVO: País + bandera en mensajes; Top-3 con #1 en negritas.

✅ NUEVO: Presupuesto de IA por ciclo y retry con max_completion_tokens adaptativo.

netlify/functions/autopick-live.cjs — EN VIVO (in-play)
OddsAPI-first (prefiltro valor), AF para minuto/fase/score, IA/EV/validaciones, FREE/VIP (VIP pin+edit), anti-duplicado por minute_bucket.

netlify/functions/autopick-outrights.cjs — A futuro (teaser 6–8d; final 22–26h)
League map y resolución por /leagues?id= con fallback a search.

netlify/functions/send.js — helpers de envío a Telegram (PRE/LIVE/OUTRIGHT)

Módulos nuevos en _lib/

_lib/match-helper.js — Normalización de cadenas, Jaccard score con boosts, resolveTeamsAndLeague (umbral configurable con MATCH_RESOLVE_CONFIDENCE).

_lib/af-resolver.cjs — resolveFixtureFromList: elige fixture mejor puntuado desde una lista AF (usa nameScore, Boost temporal ±36–60h).

prompts_punterx.md — prompts IA consolidados (sección 1) con placeholders ({{CONTEXT_JSON}}, {{OPCIONES_APOSTABLES_LIST}})

PunterX-Config.md — este documento

3) Flujo actualizado de PRE-match

OddsAPI recupera eventos ⇒ se filtran ya iniciados ⇒ se valida ventana

Principal: 40–55 min, Fallback: 35–70 min

Logs: DBG commence_time=... mins=... y totales por bucket

Match Resolver (nuevo)

match-helper.resolveTeamsAndLeague({ home, away, sport_title })

Normalización (acentos, stopwords “fc/cf/sc/afc/club/deportivo/the/el/la/los/las/de/do/da/unam”…), Jaccard + boosts por igualdad e inclusión (p.ej. “pumas” ↔ “pumas unam”)

Aplica umbral MATCH_RESOLVE_CONFIDENCE (default sugerido: 0.75)

Log: RESOLVE > home="Toluca"→"Deportivo Toluca" | away="Pumas"→"Pumas UNAM" | liga="N/D"→"Liga MX"

Enriquecimiento con API-FOOTBALL (mejorado)

Intento 1: fixtures?date=YYYY-MM-DD&league={id} (vía AF_LEAGUE_ID_BY_TITLE)

Intento 2: fixtures?league={id}&from=YYYY-MM-DD&to=YYYY-MM-DD (±2d)

Intento 3: fixtures?search=HOME AWAY (y luego por cada equipo)

Intento 4: teams?search= → IDs → fixtures?h2h=homeId-awayId&from=...&to=... (±2d)

Selección por score: nombres (home/away directo o swapped) + boost temporal (±36–60h)

Logs: “Resolver AF: asignado fixture_id=…”, “Puntaje bajo (…) para mejor candidato” y “Sin coincidencias …” con debug normalizado

Construcción de prompt con opciones apostables reales (Top mercados y mejor cuota por mercado)

OpenAI GPT-5 → JSON

Solo JSON; si length, retry con max_completion_tokens ↑

Presupuesto por ciclo: MAX_OAI_CALLS_PER_CYCLE

Validaciones: probabilidad ∈ [5%, 85%], coherencia con implícita ≤15 p.p.

EV y guardado

EV ≥10% requerido

FREE: 10–14.9%, VIP: ≥15%

Guardar en Supabase (PRE/LIVE/OUTRIGHT), Top-3 en top3_json, país y liga, sin duplicar (clave evento)

Envío a Telegram

FREE y/o VIP (VIP con bandera, país y Top-3 #1 en negritas)

4) Formatos de mensaje (consolidado)
4.1 PRE — FREE
📡 RADAR DE VALOR
🏆 {bandera} {pais} - {liga}
⚔️ {home} vs {away}
⏱️ {inicio_relativo}

{analisis_gratuito}

⏳ Quedan menos de {mins} minutos para este encuentro.

🔎 IA Avanzada, monitoreando el mercado global 24/7.
⚠️ Este contenido es informativo. Apostar conlleva riesgo.

4.2 PRE — VIP
🎯 PICK NIVEL: {emoji} {nivel}
🏆 {bandera} {pais} - {liga}
⚔️ {home} vs {away}
⏱️ {inicio_relativo}

🧠 {analisis_vip}

EV: {ev}% | Posibilidades de acierto: {prob}% | Momio: {momio_americano}
💡 Apuesta sugerida: {apuesta}
💰 Cuota usada: {cuota} {[@ point opcional]}

📋 Apuestas extra:
{apuestas_extra}

🏆 Mejores 3 casas:
<b>{bookie1 — cuota1}</b>
{bookie2 — cuota2}
{bookie3 — cuota3}

{datos_opcionales}

🔎 {TAGLINE}
⚠️ Este contenido es informativo. Apostar conlleva riesgo.

4.3 LIVE — FREE y 4.4 LIVE — VIP

(Se conservan como en la versión previa; incluyen minuto, marcador, fase, vigencia, snapshot, pin/edit en VIP).

5) Validaciones y niveles

Reglas IA:

apuesta ∈ opciones apostables vigentes

probabilidad ∈ [5, 85]

|prob(model) − prob(implícita)| ≤ 15 p.p.

Corte de EV: ≥10% (FREE 10–14.9, VIP ≥15)

Niveles VIP: 🟣 Ultra (≥40), 🎯 Élite (30–39.9), 🥈 Avanzado (20–29.9), 🥉 Competitivo (15–19.9)

6) Anti-duplicado LIVE

Clave: (fixture_id, minute_bucket) (bucket de 5 min) durante 90 min

Nuevo campo minute_bucket en picks_historicos

Envío/edit controlado con cooldown LIVE_COOLDOWN_MIN

7) Variables de entorno (nuevas y existentes)

Añadir/ajustar en Netlify → Site settings → Environment variables:

# === Ventanas PRE ===
WINDOW_MAIN_MIN=40
WINDOW_MAIN_MAX=55
WINDOW_FB_MIN=35
WINDOW_FB_MAX=70

# === IA / OpenAI ===
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5
OPENAI_MODEL_FALLBACK=gpt-5-mini
MAX_OAI_CALLS_PER_CYCLE=40
SOFT_BUDGET_MS=70000

# === Resolver / Matching ===
MATCH_RESOLVE_CONFIDENCE=0.75       # Umbral global del Match Helper (0–1)
COUNTRY_FLAG=🇲🇽                    # Bandera por defecto si no se resuelve país

# === OddsAPI ===
ODDS_API_KEY=...
# Pre:
PREFILTER_MIN_BOOKIES=2
# Live:
LIVE_MIN_BOOKIES=3
LIVE_POLL_MS=25000
LIVE_COOLDOWN_MIN=8
LIVE_MARKETS=h2h,totals,spreads
LIVE_REGIONS=eu,uk,us
LIVE_PREFILTER_GAP_PP=5
RUN_WINDOW_MS=60000

# === API-FOOTBALL ===
API_FOOTBALL_KEY=...

# === Supabase ===
SUPABASE_URL=...
SUPABASE_KEY=...

# === Telegram ===
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=...   # FREE
TELEGRAM_GROUP_ID=...     # VIP

8) netlify.toml (extracto)
[functions]
  node_bundler = "esbuild"

[functions."autopick-vip-nuevo"]
  included_files = ["prompts_punterx.md", "netlify/functions/send.js", "netlify/_lib/*"]
  external_node_modules = ["@supabase/supabase-js", "openai"]

[functions."autopick-live"]
  timeout = 60
  included_files = ["prompts_punterx.md", "netlify/functions/send.js", "netlify/_lib/*"]
  external_node_modules = ["@supabase/supabase-js", "openai"]


(Ajusta crons/headers/redirects según tu setup.)

9) Supabase — SQL idempotente
-- Tabla base
CREATE TABLE IF NOT EXISTS public.picks_historicos (
  id               bigserial PRIMARY KEY,
  evento           text,
  analisis         text,
  apuesta          text,
  tipo_pick        text,               -- 'PRE' | 'LIVE' | 'OUTRIGHT'
  liga             text,
  equipos          text,
  ev               numeric,
  probabilidad     numeric,
  nivel            text,
  timestamp        timestamptz DEFAULT now(),
  is_live          boolean DEFAULT false,
  kickoff_at       timestamptz,
  minute_at_pick   int,
  phase            text,
  score_at_pick    text,
  market_point     text,
  vigencia_text    text,
  top3_json        jsonb,
  consenso_json    jsonb,
  pais             text
);

-- Campos nuevos/compatibilidad
ALTER TABLE public.picks_historicos
  ADD COLUMN IF NOT EXISTS minute_bucket int;

-- Normalizaciones
UPDATE public.picks_historicos
SET is_live = COALESCE(is_live, false)
WHERE is_live IS DISTINCT FROM false;

-- Índices
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_picks_tipo') THEN
    CREATE INDEX idx_picks_tipo ON public.picks_historicos (tipo_pick);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_picks_evento') THEN
    CREATE INDEX idx_picks_evento ON public.picks_historicos (evento);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_picks_timestamp') THEN
    CREATE INDEX idx_picks_timestamp ON public.picks_historicos (timestamp DESC);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_picks_is_live') THEN
    CREATE INDEX idx_picks_is_live ON public.picks_historicos (is_live);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_picks_minute_bucket') THEN
    CREATE INDEX idx_picks_minute_bucket ON public.picks_historicos (minute_bucket);
  END IF;
END $$;

10) package.json (scripts útiles)
{
  "scripts": {
    "pre": "node netlify/functions/autopick-vip-nuevo.cjs",
    "out": "node netlify/functions/autopick-outrights.cjs",
    "live": "node netlify/functions/autopick-live.cjs --loop"
  }
}


Nota: En monorepo, asegura working-directory correcto en CI y un único objeto JSON raíz válido.

11) Observabilidad y puntos de log añadidos

Ventanas / filtrado:
Filtrados X eventos ya comenzados (omitidos)
DBG commence_time=… mins=…
📊 Filtrado (OddsAPI): Principal=… | Fallback=… | Total recibidos=…

Match Resolver / AF:
RESOLVE > home="…"→"…" | away="…"→"…" | liga="…"→"…"
Resolver AF: asignado fixture_id=… league="…"
Puntaje bajo (…) para mejor candidato ( … )
Sin coincidencias en API-Football (search="…", homeN="…", awayN="…")

OpenAI:
[OAI] meta= {"model":"…","ms":…,"finish_reason":"…","usage":{…}}
♻️ Fallback de modelo → gpt-5-mini
🔎 Modelo usado: …
🛑 no_pick=true → …

EV / guardado / envíos:
EV XX% < 10% → descartado
✅ Enviado VIP | ⚠️ Falló envío VIP
✅ Enviado FREE | ⚠️ Falló envío FREE
Pick duplicado, no guardado
🏁 Resumen ciclo: {...} y Duration: … ms | Memory Usage: … MB

12) Checklist de QA

 Ventanas PRE cumplen 40–55 (principal) / 35–70 (fallback)

 Resolver de equipos/liga activo y con MATCH_RESOLVE_CONFIDENCE aplicado

 Enriquecimiento AF via league_id+date y fallbacks funcionando

 Mensajes PRE/VIP con bandera/país y Top-3 correcto (#1 en negritas)

 Presupuesto IA respeta MAX_OAI_CALLS_PER_CYCLE; retry ante length

 Supabase guarda PRE/LIVE/OUTRIGHT con top3_json, pais y minute_bucket (LIVE)

 Anti-duplicado LIVE por bucket 5’ sin bloquear el fixture completo

 Telegram FREE/VIP OK; VIP con pin/edit en LIVE

13) Cambios recientes (agosto 2025)

Match Resolver (OddsAPI ↔ AF) con normalización, Jaccard y boosts; umbral MATCH_RESOLVE_CONFIDENCE.

AF por league_id+date como camino primario; fallbacks: search, teams+fixtures?h2h.

Logs de trazabilidad en PRE (ventanas, resolver, AF, IA, EV, guardado).

OpenAI: retry solo si length, max_completion_tokens adaptativo, límite por ciclo.

Bandera/país en mensajes; Top-3 reorganizado (#1 en negritas); frases de responsabilidad.

Supabase: minute_bucket para anti-duplicado LIVE + índices extra.

Outrights: mapas de liga por sportkey y resolución precisa por /leagues?id=.

14) Notas finales y próximos pasos

Estamos a la espera de los próximos logs para confirmar la caída sustancial de “Sin coincidencias en API-FOOTBALL” y la estabilidad del flujo completo.

Si persiste algún “no match”, ampliar stopwords del normalizador y/o el mapa AF_LEAGUE_ID_BY_TITLE.

Mantener cortes de EV y restricciones de probabilidad/implícita.

Evitar spam LIVE: máx. 3 ediciones por partido, con LIVE_COOLDOWN_MIN activo.

Documentar cualquier ajuste en prompts o variables aquí mismo.

TAGLINE

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
