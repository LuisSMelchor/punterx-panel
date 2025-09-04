PunterX-Config.md
1) Propósito

PunterX es un sistema de autopicks con cobertura mundial de fútbol que integra OddsAPI (v4), API-Football, OpenAI, Supabase y publicación a Telegram/Panel. Genera picks de alto valor sin listas fijas de equipos ni partidos simulados, con guardrails de calidad y seguridad.

Novedades clave (2025):

Auditoría CLV (Closing Line Value) integrada en pipelines.

Bot Start Trial: flujo de prueba VIP de 15 días desde canal FREE → bot → invitación al grupo VIP.

Wrapper estable autopick-vip-run2.cjs con rutas de diagnóstico (ping, ls, lsroot) y delegación al impl.

2) Principios y Guardrails

Sin equipos fijos en código/prompts/filtros.

Sin partidos simulados (solo fixtures reales).

Matching estricto con AF si STRICT_MATCH=1: si no hay fixture_id inequívoco → se descarta.

Logs de depuración solo con etiqueta [AF_DEBUG]. Producción silenciosa.

Cambios mínimos e idempotentes; uso de sentinelas para evitar duplicados.

Sin secretos en repos/docs. Variables de entorno: solo nombres.

3) Arquitectura (alto nivel)

Netlify Functions (CJS): pipelines de autopick, envíos, diagnósticos, admin.

Supabase: tabla de picks, locks distribuidos, snapshots de odds, usuarios/membresías, eventos, auditoría CLV.

OddsAPI (v4): mercados h2h/totals/spreads y cuotas.

API-Football: resolveTeamsAndLeague + enriquecimiento (liga/país/xG/availability/contexto).

OpenAI: modelo principal + fallback, guardrails de no-pick, coherencias.

Telegram: canal FREE y grupo VIP; bot gestiona trial y membresías.

Panel (opcional): endpoints para visualización/métricas.

4) Estructura relevante (netlify/functions)

autopick-vip-run2.cjs → wrapper estable: ping/ls/lsroot, inyección de AUTH en scheduled/manual, delegación al impl.

/_lib/autopick-vip-nuevo-impl.cjs → implementación de negocio (handler real).

/_lib/ módulos: enrich.cjs, attach-odds.cjs, match-helper.cjs, af-resolver.cjs, markets-*, format-*, _logger.cjs, _telemetry.cjs, _users.cjs, _supabase-client.cjs, ai.cjs, score.cjs, etc.

Funciones diagnósticas: diag-*.cjs (require/env/odds/resolver/enrich).

Admin/Bot: admin-grant-vip.cjs, telegram-webhook.cjs.

Otros pipelines: clv-settle.cjs, send.js, ping.cjs.

5) Flujo del handler (Run2 → Impl)

Wrapper (autopick-vip-run2.cjs):

Rutas de diagnóstico: ?ping=1, ?ls=1, ?lsroot=1.

Inyección AUTH si scheduled o ?manual=1 (headers: x-auth, x-auth-code, authorization, x-api-key).

Delegación dinámica a /_lib/autopick-vip-nuevo-impl.cjs.

Impl (autopick-vip-nuevo-impl.cjs – negocio):

assertEnv y boot defensivo.

Locks (memoria + distribuido).

OddsAPI: fetch + normalización + ventana principal/fallback.

Prefiltro (prioriza, no descarta).

API-Football: resolveTeamsAndLeague y enriquecimiento.

OpenAI: prompt maestro, fallback/retries, no_pick permitido.

Coherencias: outcome ↔ apuesta, probabilidad ↔ implícita, EV mínimo.

Snapshots NOW/PREV (señal de mercado).

Corazonada IA (score + motivo).

Clasificación y envío (VIP/FREE) + persistencia (Supabase).

Resumen y liberación de locks.

6) Variables de entorno (nombres y uso breve)
Variable	Uso breve
SUPABASE_URL	Endpoint Supabase
SUPABASE_KEY	API Key Supabase
OPENAI_API_KEY	Acceso a OpenAI
OPENAI_MODEL	Modelo principal (p.ej. gpt-5-mini)
OPENAI_MODEL_FALLBACK	Fallback (p.ej. gpt-5)
ODDS_API_KEY	OddsAPI v4
API_FOOTBALL_KEY	API-Football
TELEGRAM_BOT_TOKEN	Bot Telegram
TELEGRAM_CHANNEL_ID	Canal FREE
TELEGRAM_GROUP_ID	Grupo VIP
AUTH_CODE	Código de autenticación interno (wrapper/cron/manual)
PANEL_ENDPOINT	Endpoint del Panel (opcional)
COUNTRY_FLAG	Localización/branding opcional
ODDS_SPORT_KEY	Deporte base (p.ej. soccer)
ODDS_REGIONS	Regiones OddsAPI (us,uk,eu,au)
WINDOW_MAIN_MIN/MAX	Ventana principal (min a kickoff)
WINDOW_FB_MIN/MAX	Ventana fallback
SUB_MAIN_MIN/MAX	Sub-ventana interna
PREFILTER_MIN_BOOKIES	Mín. casas con cuota para considerar
MAX_CONCURRENCY	Concurrencia procesamiento
MAX_PER_CYCLE	Máx. picks por ciclo
SOFT_BUDGET_MS	Presupuesto de tiempo
MAX_OAI_CALLS_PER_CYCLE	Límite de llamadas a OpenAI por ciclo
ODDS_PREV_LOOKBACK_MIN	Lookback minutos para snapshot PREV
STRICT_MATCH	1 = AF matching estricto
MATCH_RESOLVE_CONFIDENCE	Umbral de confianza en resolver nombres
LOG_VERBOSE	1 = logs ampliados (dev)
DEBUG_TRACE	1 = trazas detalladas (dev)
CORAZONADA_ENABLED	1 = activa Corazonada IA
TRIAL_DAYS	Días de prueba VIP (ej. 15)
TRIAL_INVITE_TTL_SECONDS	TTL del link de invitación VIP
NODE_VERSION	(Netlify) versión Node en runtime
LAMBDA_TASK_ROOT	(ambiente serverless) raíz ejecución

Solo nombres; no incluir valores en este documento.

7) Defaults recomendados (código/config)

OPENAI_MODEL = gpt-5-mini

OPENAI_MODEL_FALLBACK = gpt-5

ODDS_REGIONS = us,uk,eu,au

ODDS_SPORT_KEY = soccer

Ventanas:

WINDOW_MAIN_MIN=45, WINDOW_MAIN_MAX=55

WINDOW_FB_MIN=35, WINDOW_FB_MAX=70

SUB_MAIN_MIN=45, SUB_MAIN_MAX=55

PREFILTER_MIN_BOOKIES=2

MAX_CONCURRENCY=6, MAX_PER_CYCLE=50

SOFT_BUDGET_MS=70000

MAX_OAI_CALLS_PER_CYCLE=40

ODDS_PREV_LOOKBACK_MIN=7

STRICT_MATCH=1 (recomendado)

LOG_VERBOSE=0 en prod; usar [AF_DEBUG] en dev.

8) Componentes clave (módulos _lib/)

enrich.cjs → compone mercados top-3 (markets_top3), formatea prompt, payload one-shot.

match-helper.cjs → resolveTeamsAndLeague y normalización de nombres.

attach-odds.cjs / odds-helpers.cjs → extracción, consenso, top-3.

ai.cjs → cliente OpenAI + retries/fallback + guardrails de no-pick.

_logger.cjs → logger con niveles; [AF_DEBUG] en dev.

_supabase-client.cjs / db.cjs → persistencia y locks distribuidos.

_users.cjs → altas/bajas, VIP, bans, eventos de usuario.

_telemetry.cjs → métrica opcional (opt-in).

score.cjs → scoring/EV mínimo.

format-* → salida canónica (Telegram/Panel).

9) Señal de mercado (snapshots)

NOW: mejor precio/top-3/point.

PREV: lookup por ODDS_PREV_LOOKBACK_MIN.

Usos: detectar movimientos y priorizar picks, apoyar CLV.

10) Corazonada IA

computeCorazonada: calcula score y motivo a partir de mercado/outcome, oddsNow/oddsPrev, xG/availability/contexto AF.

Controlado por CORAZONADA_ENABLED.

11) Telegram/Bot/Panel

FREE/VIP mediante compositores de mensaje (formatters) y bot con flujo /start → trial de TRIAL_DAYS.

TRIAL_INVITE_TTL_SECONDS para vigencia del enlace.

PANEL_ENDPOINT (si se usa) para registro/visualización.

12) Rutas de diagnóstico (wrapper)

?ping=1 → latido JSON.

?ls=1 → lista __dirname en runtime.

?lsroot=1 → lista LAMBDA_TASK_ROOT (si aplica).

?manual=1 (+AUTH) → fuerza modo manual con delegación al impl.

13) Criterios de DONE (picks)

Fixture AF válido (si STRICT_MATCH=1).

Mercado/outcome válido con cuota coherente (prob implícita/EV).

Guardrail no-pick respetado.

Snapshot NOW y (si aplica) PREV registrados.

Persistencia correcta (Supabase) y, si procede, envíos a Telegram/Panel.

14) Pruebas y smoke (local)

Wrapper: ?ping=1, ?ls=1, ?lsroot=1.

Manual: ?manual=1 con AUTH_CODE presente en entorno.

Módulos: validación sintaxis CJS con new Function(...).

Dev: usar [AF_DEBUG] y LOG_VERBOSE=1 en pruebas; no en prod.

15) Compatibilidad de runtime

Objetivo: Node 20+ en Netlify.

Probado localmente también con Node 22 (compatibilidad confirmada en CJS).

Fin del documento.
