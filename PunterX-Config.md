PunterX-Config.md

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
- `autopick-vip-nuevo.cjs`: handler principal autopick VIP.
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

## 6) Flujo del handler `autopick-vip-nuevo`
1. **Auth temprana** (header `x-auth-code` vs `AUTH_CODE`).
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

Se agregan al resumen y “Top causas” al cierre.

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

## 13) API‑Football (AF)
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
- `LOG_VERBOSE`=`1` (vista previa eventos)
- `DEBUG_TRACE`=`1` (trazas matching AF)
- `PREFILTER_MIN_BOOKIES`=2
- `MAX_CONCURRENCY`=6
- `MAX_PER_CYCLE`=50
- `SOFT_BUDGET_MS`=70000
- `MAX_OAI_CALLS_PER_CYCLE`=40
- `ODDS_PREV_LOOKBACK_MIN`=7
- `STRICT_MATCH` (1 recomendado)

PunterX-Config.md

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
- `autopick-vip-nuevo.cjs`: handler principal autopick VIP.
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

20) af-resolver.cjs (resumen mínimo)
Exporta afApi y resolveTeamsAndLeague(params, { afApi }).

Recibe { home, away, commence_time, liga } y responde { ok, fixture_id, league_id, country, reason? }.

Controlable por MATCH_RESOLVE_CONFIDENCE. No usar listas fijas de equipos.

21) Normalización de OddsAPI
normalizeOddsEvent(ev) debe:

Estimar minutosFaltantes (UTC).

Generar id estable (p. ej. hash competitivo con hora/participantes).

Extraer mejores cuotas por mercado (best/label/top3).

22) Prompt maestro (resumen)
Debe presentar opciones apostables reales detectadas en partido.marketsBest.

Evitar outcomes inexistentes. Cerrar con instrucciones claras (probabilidad, EV, no_pick si no cumple umbrales, coherencia con cuotas implícitas).

23) EV y coherencias
estimarlaProbabilidadPct(pick) → 5–85% (descarta fuera).

Implícita por cuota: delta ≤ 15% con modelada (descarta fuera).

calcularEV(probPct, cuota) → mínimo 10% (VIP si ≥ 15%).

Validar apuesta ↔ outcome (etiquetas/handicap/over‑under/1X2).

24) Snapshots
NOW: saveOddsSnapshot({ event_key, fixture_id, market, outcome_label, point, best_price, best_bookie, top3_json }).

PREV: getPrevBestOdds({ event_key, market, outcome_label, point, lookbackMin }).

25) Corazonada IA (detalle)
inferPickSideFromApuesta / inferMarketFromApuesta.

buildXgStatsFromAF, buildAvailabilityFromAF, buildContextFromAF.

computeCorazonada({ pick:{side,market}, oddsNow:{best}, oddsPrev:{best}, xgStats, availability, context }).

Uso opcional según CORAZONADA_ENABLED.

26) Seguridad / Auth
Header x-auth-code debe igualar AUTH_CODE. Si no:

Modo normal: 403.

Modo debug (?debug=1 o x-debug: 1): JSON { stage:'auth', error:'forbidden' } (status 200 para facilitar diagnóstico).

27) Buenas prácticas de edición
Nunca dupliques cabeceras/locks/vars. Revisa con node --check file.cjs.

Cierra siempre try/catch/finally.

Usa diag-* antes de modificar lógica si ves 500 opaco.

28) Actualización 2025-08-20: Diagnóstico de 500 opaco y hardening del handler
28.1 ¿Qué estaba pasando?
La función autopick-vip-nuevo devolvía HTTP 500 con cuerpo Internal Error. ID: <...>. Esto significa que el runtime de Netlify atrapó una excepción antes de nuestros try/catch del ciclo principal, por ejemplo:

Módulos no resolvibles durante el bundle (o en el runtime).

Errores de sintaxis o bloques pegados en duplicado (p.ej. variables ya declaradas).

Fallo temprano al inicializar clientes/env.

En los logs de aplicación vimos además descartes por STRICT_MATCH=1 → sin AF.fixture_id, lo que indicaba que el resolver de fixtures de API‑Football no estaba devolviendo un fixture válido para algunos eventos, y por política estricta se descartaban.

28.2 Dos endpoints de diagnóstico añadidos
Están en netlify/functions/diag-require.cjs y netlify/functions/diag-env.cjs. No exponen secretos; sólo dicen si “están” o “faltan”.

/.netlify/functions/diag-require: verifica que los módulos locales y paquetes NPM se resuelven en el runtime de Netlify.

Salida esperada (ejemplo real):

json
Copiar
Editar
{
  "ok": true,
  "requires": {
    "_logger": { "ok": true },
    "_diag_core": { "ok": true },
    "_supabase_client": { "ok": true },
    "_telemetry": { "ok": true },
    "_users": { "ok": true },
    "corazonada": { "ok": true },
    "af_resolver": { "ok": true },
    "pkg_openai": { "ok": true },
    "pkg_supabase": { "ok": true },
    "pkg_fetch": { "ok": true }
  }
}
/.netlify/functions/diag-env: lista las variables críticas como (set) / (MISSING) para detectar huecos sin exponer valores.

Comandos útiles

bash
Copiar
Editar
# Verificar módulos en runtime (devuelve JSON)
curl -s "https://<tu-sitio>.netlify.app/.netlify/functions/diag-require" -H "x-debug: 1" | jq .

# Verificar ENV esenciales
curl -s "https://<tu-sitio>.netlify.app/.netlify/functions/diag-env" -H "x-debug: 1" | jq .

# Forzar modo depuración del handler (cuerpo JSON en errores de boot)
curl -i "https://<tu-sitio>.netlify.app/.netlify/functions/autopick-vip-run2?debug=1" \
  -H "x-auth-code: $AUTH_CODE" \
  -H "x-debug: 1" \
  -H "cache-control: no-cache"
28.3 Hardening del handler (arranque defensivo + headers)
Se re‑estructuró la cabecera del handler para:

Autenticación antes de cargar clientes.

debug activable por query ?debug=1 o header x-debug: 1 para responder JSON en errores tempranos (en lugar de 500 opaco).

Utilidades isDebug(event) y getHeaders(event) para normalizar headers.

Un único bloque de lock en memoria y un único lock distribuido.

Bloque 2.1 — Cabecera y auth (completo y listo para pegar):

js
Copiar
Editar
// =============== NETLIFY HANDLER ===============
exports.handler = async (event, context) => {
  // --- IDs / modo debug ---
  const REQ_ID = (Math.random().toString(36).slice(2,10)).toUpperCase();
  const debug = isDebug(event);
  const headers = getHeaders(event);

  // --- Auth (antes de cualquier otra cosa) ---
  const hdrAuth = (headers['x-auth-code'] || headers['x-auth'] || '').trim();
  const expected = (process.env.AUTH_CODE || '').trim();
  if (expected && hdrAuth !== expected) {
    if (debug) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok:false, stage:'auth', req:REQ_ID, error:'forbidden', reason:'auth_mismatch' })
      };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // --- Boot: ENV + clientes, atrapado para no reventar con 500 opaco ---
  try {
    assertEnv();
    await ensureSupabase();
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[${REQ_ID}] Boot error:`, e?.stack || msg);
    if (debug) {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok:false, stage:'boot', req:REQ_ID, error: msg, stack: e?.stack || null })
      };
    }
    return { statusCode: 500, body: `Internal Error. REQ:${REQ_ID}` };
  }

  // --- Logger de ciclo ---
  const traceId = 'a' + Math.random().toString(36).slice(2,10);
  const logger = createLogger(traceId);
  logger.section('CICLO PunterX');
  logger.info('▶️ Inicio ciclo; now(UTC)=', new Date().toISOString());

  const CICLO_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  console.log(`▶️ CICLO ${CICLO_ID} start; now(UTC)= ${new Date().toISOString()}`);

  const started = Date.now();
  try { await upsertDiagnosticoEstado('running', null); } catch(_) {}
  console.log(`⚙️ Config ventana principal: ${WINDOW_MAIN_MIN}–${WINDOW_MAIN_MAX} min | Fallback: ${WINDOW_FB_MIN}–${WINDOW_FB_MAX} min`);
Bloque 2.3 — Locks y resumen (completo y listo para pegar):

js
Copiar
Editar
  // --- Lock simple en memoria por invocación aislada (Netlify) ---
  if (global.__punterx_lock) {
    console.warn('LOCK activo → salto ciclo');
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true }) };
  }
  global.__punterx_lock = true;

  // --- Lock distribuido (Supabase) ---
  const gotLock = await acquireDistributedLock(120);
  if (!gotLock) {
    console.warn('LOCK distribuido activo → salto ciclo');
    return { statusCode: 200, body: JSON.stringify({ ok:true, skipped:true, reason:'lock' }) };
  }

  // --- Acumuladores de ciclo ---
  const resumen = {
    recibidos: 0, enVentana: 0, candidatos: 0, procesados: 0, descartados_ev: 0,
    enviados_vip: 0, enviados_free: 0, intentos_vip: 0, intentos_free: 0,
    guardados_ok: 0, guardados_fail: 0, oai_calls: 0,
    principal: 0, fallback: 0, af_hits: 0, af_fails: 0,
    sub_45_55: 0, sub_40_44: 0
  };

  const causas = {
    strict_mismatch: 0, no_pick_flag: 0, outcome_invalido: 0, prob_fuera_rango: 0,
    incoherencia_pp: 0, ev_insuficiente: 0, ventana_fuera: 0, duplicado: 0, otros: 0
  };
Importante: Asegúrate de no tener duplicado ningún bloque de lock ni variables como CICLO_ID, started, gotLock. Los errores Identifier '... ' has already been declared que vimos (CICLO_ID/started/gotLock) fueron causados por pegar cabeceras dos veces.

28.4 Interpretación de los descartes STRICT_MATCH=1
El ciclo muestra STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO (sin_fixtures_dia).

Esto no es bug de lógica; es la política estricta: si API‑Football no da un fixture_id inequívoco para el evento de OddsAPI, se descarta.

Verificar que en af-resolver.cjs exista y se use:

js
Copiar
Editar
const { resolveTeamsAndLeague, afApi } = require('./_lib/af-resolver.cjs');
// ...
const rsl = await resolveTeamsAndLeague(
  { home: P.home, away: P.away, commence_time: P.commence_time, liga: P.liga || P.sport_title || '' },
  { afApi }
);
if (!rsl.ok) { /* contar strict_mismatch y saltar */ }
Si quieres ajustar sensibilidad, usa MATCH_RESOLVE_CONFIDENCE (ENV) y/o lógicas de normalización de nombres en ese módulo, sin introducir listas fijas de equipos (regla del proyecto).

28.5 Dependencias y bundling
Se instalaron (verificados por diag-require):
openai@4, @supabase/supabase-js@2, node-fetch@3.

netlify.toml incluye external_node_modules adecuados para que Netlify los empaquete.

Node 20 ya expone fetch; node-fetch sólo se usa si tu helper lo requiere explícitamente.

29) Variables de entorno revisadas (todas soportadas hoy)
Claves críticas para este handler (con sus defaults en código cuando aplica):

AUTH_CODE (obligatoria) → valida header x-auth-code.

SUPABASE_URL, SUPABASE_KEY (obligatorias).

OPENAI_API_KEY (obligatoria), OPENAI_MODEL=gpt-5-mini, OPENAI_MODEL_FALLBACK=gpt-5.

ODDS_API_KEY (obligatoria), ODDS_REGIONS=us,uk,eu,au, ODDS_SPORT_KEY=soccer.

Ventanas: WINDOW_MAIN_MIN=45, WINDOW_MAIN_MAX=55, WINDOW_FB_MIN=35, WINDOW_FB_MAX=70, SUB_MAIN_MIN=45, SUB_MAIN_MAX=55.

Log: LOG_VERBOSE=1 para vista previa de próximos eventos; DEBUG_TRACE=1 para trazas detalle de matching AF.

Límites: MAX_PER_CYCLE=50, MAX_OAI_CALLS_PER_CYCLE=40, SOFT_BUDGET_MS=70000, PREFILTER_MIN_BOOKIES=2, MAX_CONCURRENCY=6.

Señal de mercado (snapshots): ODDS_PREV_LOOKBACK_MIN=7.

Estrictos: STRICT_MATCH=1 para requerir fixture_id válido.

Telegram/PANEL: TELEGRAM_*, PANEL_ENDPOINT, COUNTRY_FLAG (opcional, ej. 🇲🇽).

Confirmado por tu panel de Netlify: todas estas existen. diag-env te permite ver rápidamente si alguna queda en (MISSING) al cambiar contextos.

## 30) Errores que ya vimos y cómo se solucionaron
(sección ampliada con CLV + bot trial, explicado arriba)

## 31) Próximos pasos
- Probar con usuario real (ej. cuenta Telegram de tu novia).
- Validar onboarding → grant VIP trial → invitación → acceso grupo VIP.  
- Revisar auditoría CLV en picks históricos (columna extra en `picks_historicos` o tabla dedicada).  
- Limpiar PRs futuros siguiendo el flujo: feature branch → PR → merge → borrar branch.

32) Recordatorios de reglas del proyecto (se mantienen)
No usar nombres fijos de equipos ni whitelists/blacklists estáticas.

No correr tests con partidos simulados; sólo eventos reales (OddsAPI).

STRICT_MATCH=1 está permitido (y recomendable) para evitar falsos matches.

## 33) Bloque finally recomendado
(... se mantiene igual, con logger y locks ...)

---
Fin del documento.

1) Esquema mínimo para Auditoría CLV
Mantiene tu modelo actual y evita tocar tablas críticas.
Creamos una tabla nueva y opcionalmente añadimos columnas a la de picks si te conviene.
1.1 Nueva tabla px_clv_audit
Guarda, por cada pick enviado, la cuota al envío vs la cuota de cierre y los deltas.
-- 01_px_clv_audit.sql
create table if not exists public.px_clv_audit (
  id                bigserial primary key,
  pick_id           bigint not null,            -- FK a tu tabla de picks (ajusta nombre y tipo)
  fixture_id        bigint,                     -- id del partido (API-Football) si aplica
  league            text,
  market_key        text not null,              -- p.ej. 'h2h', 'totals', 'spreads'
  outcome_key       text not null,              -- p.ej. 'home', 'away', 'over_2_5'
  sent_price        numeric,                    -- cuota cuando se envió el pick
  close_price       numeric,                    -- cuota a cierre
  clv_pp            numeric,                    -- delta de prob en puntos porcentuales (implícita(sent) - implícita(close))
  clv_pct           numeric,                    -- (sent_price/close_price - 1) * 100  (si prefieres basado en precio)
  ev_sent           numeric,                    -- EV estimado al envío (si lo tenías)
  ev_close          numeric,                    -- EV estimado al cierre (si lo calculas)
  ev_delta          numeric,                    -- ev_close - ev_sent
  collected_at      timestamptz not null default now(),
  source            text,                       -- 'oddsapi', 'panel', 'crawler', etc.
  notes             jsonb default '{}'::jsonb
);

-- Índices útiles
create index if not exists idx_px_clv_audit_pick    on public.px_clv_audit (pick_id);
create index if not exists idx_px_clv_audit_fixture on public.px_clv_audit (fixture_id);
create index if not exists idx_px_clv_audit_time    on public.px_clv_audit (collected_at desc);

-- (Opcional) FK si conoces la tabla exacta:
-- alter table public.px_clv_audit
-- add constraint fk_px_clv_pick foreign key (pick_id) references public.px_picks(id) on delete cascade;
1.2 (Opcional) Columnas nuevas en tu tabla de picks
Si quieres tener todo “a la mano” en la fila del pick:
-- 02_px_picks_optional.sql
alter table if exists public.px_picks
  add column if not exists sent_price numeric,
  add column if not exists sent_implied_prob numeric,   -- 1/sent_price
  add column if not exists clv_pp numeric,              -- redundancia para lecturas rápidas
  add column if not exists clv_pct numeric,
  add column if not exists clv_updated_at timestamptz;
Si no tienes public.px_picks, ajusta al nombre real de tus picks.
________________________________________
2) Vistas de resumen para el panel
2.1 Vista “últimos 30 días”
-- 03_v_px_clv_summary_30d.sql
create or replace view public.v_px_clv_summary_30d as
select
  date_trunc('day', collected_at) as d,
  count(*)                                 as n,
  avg(clv_pp)                               as clv_pp_avg,
  percentile_cont(0.5) within group (order by clv_pp) as clv_pp_p50,
  avg(clv_pct)                              as clv_pct_avg,
  avg((clv_pp > 0)::int)                    as share_positive_pp,   -- % picks que “ganan a la línea”
  avg((clv_pct > 0)::int)                   as share_positive_pct
from public.px_clv_audit
where collected_at >= now() - interval '30 days'
group by 1
order by 1 desc;
2.2 Vista “por market/outcome”
-- 04_v_px_clv_by_market.sql
create or replace view public.v_px_clv_by_market as
select
  market_key,
  outcome_key,
  count(*)                      as n,
  avg(clv_pp)                   as clv_pp_avg,
  percentile_cont(0.5) within group (order by clv_pp) as clv_pp_p50,
  avg((clv_pp > 0)::int)        as share_positive_pp
from public.px_clv_audit
group by 1,2
order by n desc;
________________________________________
3) Cálculo de CLV (fórmulas simples)
•	Probabilidad implícita: p = 1/cuota.
•	CLV (puntos porcentuales): clv_pp = (1/sent_price - 1/close_price) * 100.
•	CLV basado en precio: clv_pct = (sent_price/close_price - 1) * 100.
•	EV (si lo usas): ev = p_model * price - 1.
Evitar mezclar EV con prob implícita del mercado para no duplicar efectos; guarda ambos para análisis.
________________________________________
4) Inserción desde Netlify Function (JS/CJS)
Llama esto cuando detectes “cierre” (ej. cron cercano al kickoff o a minuto 0).
Ajusta imports/paths según tu repo (ya usas _lib/_supabase-client.cjs).
// netlify/functions/_lib/clv-helpers.cjs
'use strict';
const getSupabase = require('./_supabase-client.cjs');

function implied(probOrPrice, mode='from_price') {
  if (mode === 'from_price') return (probOrPrice > 0) ? 1 / probOrPrice : null;
  return probOrPrice; // si ya viene como probabilidad
}

async function saveClvAudit({
  pick_id,
  fixture_id,
  league,
  market_key,
  outcome_key,
  sent_price,
  close_price,
  ev_sent = null,
  ev_close = null,
  source = 'oddsapi',
  notes = {}
}) {
  const supabase = getSupabase();
  const ip_sent  = implied(sent_price);
  const ip_close = implied(close_price);
  const clv_pp   = (ip_sent && ip_close) ? (ip_sent - ip_close) * 100 : null;
  const clv_pct  = (sent_price && close_price) ? ((sent_price / close_price) - 1) * 100 : null;
  const ev_delta = (ev_close != null && ev_sent != null) ? (ev_close - ev_sent) : null;

  const row = {
    pick_id, fixture_id, league, market_key, outcome_key,
    sent_price, close_price, clv_pp, clv_pct, ev_sent, ev_close, ev_delta,
    source, notes
  };

  const { error } = await supabase.from('px_clv_audit').insert([row]);
  if (error) throw new Error(`[CLV] insert error: ${error.message}`);

  // opcional: reflejar en la tabla de picks (si añadiste columnas)
  if (pick_id) {
    await supabase.from('px_picks').update({
      clv_pp, clv_pct, clv_updated_at: new Date().toISOString()
    }).eq('id', pick_id);
  }

  return { ok: true, clv_pp, clv_pct, ev_delta };
}

module.exports = { saveClvAudit };
Ejemplo de uso (cron de cierre)
// netlify/functions/clv-close-cron.cjs
'use strict';
const { saveClvAudit } = require('./_lib/clv-helpers.cjs');

exports.handler = async () => {
  try {
    // 1) Trae picks próximos a empezar o recién empezados sin CLV
    // 2) Obtén close_price (última cuota antes del kickoff) desde fuente (OddsAPI/tu snapshot)
    // 3) Guarda CLV
    // (Ejemplo con datos ficticios del loop)
    const jobs = [
      {
        pick_id: 123,
        fixture_id: 999001,
        league: 'EPL',
        market_key: 'h2h',
        outcome_key: 'home',
        sent_price: 1.95,
        close_price: 1.80,
        ev_sent: 0.08,
        ev_close: 0.04
      }
    ];

    const results = [];
    for (const j of jobs) {
      results.push(await saveClvAudit(j));
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, results }) };
  } catch (e) {
    return { statusCode: 500, body: e?.message || 'error' };
  }
};
________________________________________
5) Backfill (histórico) — opcional
Si ya tienes snapshots de cuotas (recomendado) tipo px_odds_snapshots:
-- 05_backfill_lookup_close.sql  (ejemplo orientativo)
-- Supone snapshots con: fixture_id, market_key, outcome_key, price, captured_at
with last_before_kick as (
  select s.fixture_id, s.market_key, s.outcome_key,
         s.price as close_price,
         row_number() over (partition by s.fixture_id, s.market_key, s.outcome_key
                            order by s.captured_at desc) as rn
  from public.px_odds_snapshots s
  join public.fixtures f on f.id = s.fixture_id
  where s.captured_at <= f.kickoff_time
)
select * from last_before_kick where rn = 1;
Luego insertas en px_clv_audit cruzando con tus picks para obtener sent_price y close_price.
Si no tienes snapshots, puedes usar la última lectura previa al envío (no es perfecto, pero sirve como proxy).
________________________________________
6) Consultas útiles (panel/QA)
% de picks que ganan a la línea (últimos 30 días):
select
  avg((clv_pp > 0)::int) as pct_positive
from public.px_clv_audit
where collected_at >= now() - interval '30 days';
Top ligas por CLV medio:
select
  league,
  count(*) as n,
  avg(clv_pp) as clv_pp_avg
from public.px_clv_audit
group by 1
having count(*) >= 20
order by clv_pp_avg desc;
Distribución por market/outcome (para afinar reglas):
select market_key, outcome_key,
       count(*) n,
       avg(clv_pp) clv_pp_avg,
       percentile_cont(0.5) within group (order by clv_pp) as p50
from public.px_clv_audit
group by 1,2
order by n desc;
________________________________________
7) Notas operativas
•	Dónde calcular CLV:
o	Cron dedicado (recomendado) justo antes del kickoff / al comenzar el partido.
o	O al final del día para todos los picks del día.
•	Idempotencia:
Antes de insertar, puedes verificar si ya hay una fila para (pick_id, market_key, outcome_key) y hacer upsert.
•	Calidad de datos:
Siempre guarda sent_price junto con el pick enviado. Así no dependes del histórico externo para reconstruir CLV.
•	Privacidad/Transparencia:
CLV no revela secretos del modelo; muestra ejecución (que compramos valor real). Es perfecto para dashboard y marketing serio.
________________________________________
8) Checklist (rápido)
1.	Ejecuta las migraciones SQL 01–04 (y 02 si quieres columnas en picks).
2.	(Opcional) Prepara backfill si cuentas con snapshots.
3.	Añade el helper saveClvAudit y programa un cron que actualice CLV.
4.	Conecta el panel a v_px_clv_summary_30d y v_px_clv_by_market.
5.	Publica un bloque de transparencia en el panel con:
o	% picks con CLV positivo (30d).
o	Media/mediana de CLV.
o	Series diarias.

