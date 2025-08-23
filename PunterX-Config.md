# PunterX-Config.md

## 1) Introducción
PunterX es un sistema avanzado de picks automatizados y panel de control, que integra fuentes de datos de cuotas, enriquecimiento con API-Football, modelado con OpenAI y publicación a Telegram/PANEL. El objetivo es generar picks de alto valor sin usar listas fijas de equipos ni partidos simulados, cumpliendo con políticas estrictas de calidad y seguridad de datos.

Además, a partir de agosto 2025, el sistema integra:
- **Auditoría CLV (Closing Line Value)**: cálculo y registro de cuánto valor agregado tiene un pick comparado con el movimiento de la línea de cierre.  
- **Flujo Bot Start Trial**: desde el canal FREE, el usuario va al bot, da `/start` y automáticamente recibe **15 días de prueba VIP**, con onboarding y acceso directo al grupo privado.  

## 2) Arquitectura general
- **Netlify Functions** (CJS/JS): funciones serverless para pipelines de autopick, envío de mensajes, auditorías y endpoints administrativos.
- **Supabase**: almacenamiento (picks, locks distribuidos, snapshots de odds, usuarios, membresías, eventos de usuario, auditorías CLV).
- **OddsAPI (v4)**: fuente de mercados (h2h/totals/spreads) y cuotas.
- **API-Football**: enriquecimiento (fixture_id, liga, país, xG/availability/contexto).
- **OpenAI**: modelado (GPT-5 + fallback).
- **Telegram**: canal FREE y grupo VIP. El bot gestiona prueba y membresías.
- **Panel (endpoint opcional)**: distribución y métricas.

> Reglas: **sin equipos fijos**, **sin partidos simulados**, matching de fixtures **estricto** si `STRICT_MATCH=1`.

## 3) Estructura de directorios (Netlify/functions)
Incluye ahora:
- `_users.cjs`: alta, baja, VIP, bans, eventos de usuarios.
- `autopick-vip-nuevo-impl.cjs`: implementación real del handler de autopick VIP.
- `autopick-vip-run2.cjs`: wrapper estable actual, usado para cron y manual (sustituye versiones anteriores).
- `telegram-webhook.cjs`: recibe comandos del bot (ej. `/start` → activa prueba VIP 15 días).
- `admin-grant-vip.cjs`: concesión manual de VIP (solo admins).
- `diag-require.cjs`, `diag-env.cjs`: diagnósticos de runtime.
- `clv-audit.cjs` (integrado en pipelines): calcula CLV al cierre y audita picks.

## 4) Variables de entorno (visibles en Netlify)
Se añadieron:
- `TRIAL_DAYS` → duración de la prueba (default: 15).
- `TRIAL_INVITE_TTL_SECONDS` → vigencia del link de invitación al grupo VIP.
- Todas las anteriores (SUPABASE_URL, SUPABASE_KEY, AUTH_CODE, TELEGRAM_BOT_TOKEN, etc.) siguen siendo obligatorias.  
- Confirmado: Node 20 (`NODE_VERSION=20.x`) y modelo por defecto `OPENAI_MODEL=gpt-5-mini`.

## 5) Reglas operativas
- **Sin equipos fijos** en código/prompt/filters (regla general).
- **Sin simulaciones** (no se hacen tests con partidos simulados; sólo fixtures reales).
- Uso de **STRICT_MATCH** cuando corresponde para evitar falsos positivos en el matching AF.

## 6) Flujo del handler `autopick-vip-run2`
1. **Auth temprana** (header `x-auth-code` vs `AUTH_CODE`).
   - Si es ejecución scheduled (cron) → wrapper inyecta AUTH automáticamente.  
   - Si es modo debug (?debug=1 o x-debug:1) → siempre responde en JSON, incluso en errores.
2. **Boot defensivo** (`assertEnv()`, `ensureSupabase()`).
3. **Logger de ciclo** (traceId + sección).
4. **Locks**: en memoria y distribuido (Supabase).
5. **OddsAPI**: fetch, normalización, ventana (principal y fallback).
6. **Prefiltro** (prioriza, no descarta).
7. **AF resolver** (`resolveTeamsAndLeague`) + enriquecimiento (xG, availability, contexto).
8. **OpenAI**: prompt maestro con mercados válidos, fallback, reintentos; guardrail de no-pick.
9. **Selección de cuota** exacta; coherencias probabilidad/implícita/EV.
10. **Snapshots de mercado** (NOW y lookup PREV).
11. **Corazonada IA**.
12. **Clasificación y envío** (VIP/FREE).
13. **Persistencia** (Supabase).
14. **Resumen y finally** (liberar locks, logs, métricas).

## 7) Logs típicos de ciclo
- Inicio ciclo, now(UTC)
- Config ventanas
- `ODDSAPI ok=true count=N`
- Vista previa de próximos eventos (si `LOG_VERBOSE=1`)
- `📊 Filtrado (OddsAPI): …`
- `STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO (…)`
- Resumen ciclo (conteos/causas)

## 8) Causas de descarte (conteos)
- `strict_mismatch`
- `no_pick_flag`
- `outcome_invalido`
- `prob_fuera_rango`
- `incoherencia_pp`
- `ev_insuficiente`
- `ventana_fuera`
- `duplicado`
- `otros`

## 9) Señal de mercado (snapshots)
- `odds_snapshots` con NOW (best price, top3, point si aplica) y lookup PREV (lookback min configurable).
- Útil para detectar movimientos de cuota y priorización.

## 10) Corazonada IA
- `computeCorazonada` calcula `score` y `motivo` en base a:
  - Mercado/outcome (side, market)
  - oddsNow/oddsPrev (best)
  - xG, availability, contexto AF
- Activable con `CORAZONADA_ENABLED`.

## 11) OpenAI y guardrails
- **Modelo**: `OPENAI_MODEL` (por defecto `gpt-5-mini`) con fallback `OPENAI_MODEL_FALLBACK` (por defecto `gpt-5`).
- **Retries** y **fallback** encapsulados en `obtenerPickConFallback`.
- **no_pick**: permitido (no enviar en condiciones de baja calidad).
- **Coherencias**: apuesta ↔ outcome seleccionado; probabilidad ↔ implícita; EV mínimo.

## 12) OddsAPI
- **Endpoint**: `/v4/sports/<SPORT_KEY>/odds`
- **markets**: `h2h,totals,spreads` (puedes extender si el prompt los soporta).
- **regions** configurable: `ODDS_REGIONS`.
- **Filtro por ventana** (minutos hasta kickoff) y orden por score preliminar.

## 13) API-Football (AF)
- `resolveTeamsAndLeague` (con `afApi`) para obtener `fixture_id` inequívoco.
- Enriquecimiento: liga, país, xG, availability, contexto.
- Si `STRICT_MATCH=1` y no hay match inequívoco → descartar.

## 14) Telegram / Panel
- VIP/FREE mediante `enviarVIP` / `enviarFREE`.
- `PANEL_ENDPOINT` (si se usa) para registrar/visualizar.

## 15) Defaults en código (sumario)
- `OPENAI_MODEL`=`gpt-5-mini`
- `OPENAI_MODEL_FALLBACK`=`gpt-5`
- `ODDS_REGIONS`=`us,uk,eu,au`
- `ODDS_SPORT_KEY`=`soccer`
- **Ventanas**:
  - `WINDOW_MAIN_MIN`=45, `WINDOW_MAIN_MAX`=55
  - `WINDOW_FB_MIN`=35, `WINDOW_FB_MAX`=70
  - `SUB_MAIN_MIN`=45, `SUB_MAIN_MAX`=55
- `LOG_VERBOSE`=`1`
- `DEBUG_TRACE`=`1`
- `PREFILTER_MIN_BOOKIES`=2
- `MAX_CONCURRENCY`=6
- `MAX_PER_CYCLE`=50
- `SOFT_BUDGET_MS`=70000
- `MAX_OAI_CALLS_PER_CYCLE`=40
- `ODDS_PREV_LOOKBACK_MIN`=7
- `STRICT_MATCH` (1 recomendado)

---

## 28) Diagnóstico de errores 500 opacos y soluciones
**Problema**: al principio la función devolvía *Internal Error. ID: ...* sin logs visibles.  
**Soluciones aplicadas**:
- Se añadieron **diag-require** y **diag-env** para confirmar dependencias y variables.
- Se migró a **autopick-vip-run2** como wrapper estable, que:
  - Ignora `cron/tick` y fuerza `manual=1` para logs consistentes.
  - Inyecta AUTH automáticamente si falta.
  - Tiene modo `smoke=1` para probar respuesta sin cargar la implementación real.
- Se eliminaron archivos basura (run, wrapper, probe, hello).
- netlify.toml actualizado con bloque `[functions."autopick-vip-run2"]` y cron cada 15 minutos.
- Confirmado que ahora logs de resumen se ven completos en ejecuciones manuales y programadas.

## 29) Matching estricto (STRICT_MATCH)
- Observamos descartes frecuentes `STRICT_MATCH=1 → sin AF.fixture_id`.
- Esto **no es bug**, sino política estricta: si no hay match inequívoco en API-Football, se descarta.
- Próximos pasos: afinar `resolveTeamsAndLeague` con `MATCH_RESOLVE_CONFIDENCE` y normalización de nombres para reducir descartes sin listas fijas.

## 30) Errores solucionados
- SyntaxError por llaves extras en `autopick-vip-nuevo.cjs` → resuelto con wrapper.
- 500 opaco en cron → resuelto con `autopick-vip-run2`.
- Duplicación de bloques en netlify.toml → limpiado.
- Bloques de lock duplicados → corregido.
- Ahora logs muestran `resumen` con conteos y causas.

## 31) Próximos pasos inmediatos
- Afinar **matching** (STRICT_MATCH vs flexibilidad).
- Implementar métricas de descartes por tipo y ajustar resolver AF.
- Seguir integrando auditoría CLV en cron de cierre.
- Validar end-to-end con usuarios reales (bot de Telegram).
- Consolidar documentación y panel.

---

Fin del documento.
