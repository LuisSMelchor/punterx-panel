# PunterX-Config.md

## 1) Introducción
PunterX es un sistema avanzado de picks automatizados y panel de control, que integra fuentes de datos de cuotas, enriquecimiento con API‑Football, modelado con OpenAI y publicación a Telegram/PANEL. El objetivo es generar picks de alto valor sin usar listas fijas de equipos ni partidos simulados, cumpliendo con políticas estrictas de calidad y seguridad de datos.

## 2) Arquitectura general
- **Netlify Functions** (CJS/JS): funciones serverless para pipelines de autopick, envío de mensajes y endpoints administrativos.
- **Supabase**: almacenamiento (tablas de picks, locks distribuidos, snapshots de odds, etc.).
- **OddsAPI (v4)**: fuente de mercados (h2h/totals/spreads) y cuotas.
- **API‑Football**: enriquecimiento (fixture_id, liga, país, xG/availability/contexto).
- **OpenAI**: modelado (OpenAI 5 + fallback) con políticas de reintento.
- **Telegram**: destinos FREE y VIP.
- **Panel (endpoint opcional)**: distribución y métricas.

> Reglas: **sin equipos fijos** (no whitelists/blacklists), **sin partidos simulados**, matching de fixtures **estricto** si `STRICT_MATCH=1`.

## 3) Estructura de directorios (Netlify/functions)
- `_lib/af-resolver.cjs`: Resolve y helpers para API‑Football (afApi).
- `_corazonada.cjs`: Módulo “Corazonada IA” (score y motivo).
- `_logger.cjs`: Logger con `section/info/warn/error`.
- `_supabase-client.cjs`: Inicialización cliente Supabase y funciones (locks/snapshots/etc).
- `_diag-core-v4.cjs`: Utilidades de diagnóstico comunes.
- `_telemetry.cjs`: Telemetría opcional.
- `_users.cjs`: Utilidades para usuarios/invitaciones (si aplica).
- `autopick-vip-nuevo.cjs`: Handler principal de autopick VIP (nuevo).
- `autopick-live.cjs`: Live picks (si está habilitado).
- `autopick-outrights.cjs`: Outrights (si está habilitado).
- `admin-grant-vip.cjs`, `analisis-semanal.js`: varias según panel.
- `diag-require.cjs`, `diag-env.cjs`: funciones **de diagnóstico**.

## 4) Variables de entorno (visibles en Netlify)
Listado real (con tus contextos) — se mantienen como en tu panel. **No se exponen valores**:
- `API_FOOTBALL_KEY`
- `AUTH_CODE`
- `AWS_LAMBDA_JS_RUNTIME`
- `CORAZONADA_ENABLED`
- `CORAZONADA_W_AVAIL`
- `CORAZONADA_W_CTX`
- `CORAZONADA_W_MARKET`
- `CORAZONADA_W_XG`
- `DEBUG_TRACE`
- `ENABLE_OUTRIGHTS`
- `ENABLE_OUTRIGHTS_INFO`
- `LIVE_COOLDOWN_MIN`
- `LIVE_MARKETS`
- `LIVE_MIN_BOOKIES`
- `LIVE_POLL_MS`
- `LIVE_PREFILTER_GAP_PP`
- `LIVE_REGIONS`
- `LOG_EVENTS_LIMIT`
- `LOG_VERBOSE`
- `MATCH_RESOLVE_CONFIDENCE`
- `MAX_OAI_CALLS_PER_CYCLE`
- `NODE_OPTIONS`
- `NODE_VERSION`
- `ODDS_API_KEY`
- `ODDS_REGIONS`
- `ODDS_SPORT_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_MODEL_FALLBACK`
- `OUTRIGHTS_COHERENCE_MAX_PP`
- `OUTRIGHTS_EV_MIN_VIP`
- `OUTRIGHTS_EXCLUDE`
- `OUTRIGHTS_MIN_BOOKIES`
- `OUTRIGHTS_MIN_OUTCOMES`
- `OUTRIGHTS_PROB_MAX`
- `OUTRIGHTS_PROB_MIN`
- `PANEL_ENDPOINT`
- `PUNTERX_SECRET`
- `RUN_WINDOW_MS`
- `STRICT_MATCH`
- `SUB_MAIN_MAX`
- `SUB_MAIN_MIN`
- `SUPABASE_KEY`
- `SUPABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`
- `TELEGRAM_GROUP_ID`
- `TELEGRAM_VIP_GROUP_ID`
- `TRIAL_DAYS`
- `TRIAL_INVITE_TTL_SECONDS`
- `TZ`
- `WINDOW_FALLBACK_MAX`
- `WINDOW_FALLBACK_MIN`
- `WINDOW_FB_MAX`
- `WINDOW_FB_MIN`
- `WINDOW_MAIN_MAX`
- `WINDOW_MAIN_MIN`
- `WINDOW_MAX`
- `WINDOW_MIN`

> Defaults en código (cuando aplican): ver sección 15.

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

## 16) Errores observados y explicación
- **`STRICT_MATCH=1 → sin AF.fixture_id → DESCARTADO`**:
  - No es bug: con política estricta, si AF no devuelve fixture inequívoco, se descarta.
  - Puede deberse a nombres raros de equipos/ligas en OddsAPI, partidos listados con formatos distintos, etc.
- **HTTP 500: `Internal Error. ID: <…>`** (Netlify):
  - Error arrojado antes de que el handler responda: típicamente módulos no encontrados, sintaxis, o fallos en boot.
  - Se añadió **boot defensivo** y endpoints de diagnóstico (ver “Actualización”).
- **SyntaxError: `Identifier 'CICLO_ID' has already been declared` / `started` / `gotLock`**:
  - Causado por pegar **dos veces** la cabecera/locks.
  - Solución: dejar **un único** bloque (ver “Bloques listos para pegar” más abajo).
- **`Unexpected end of input`**:
  - Faltaban llaves/cierres tras recortes parciales. Solución: conservar el `finally` completo (ver sección 33).

## 17) Endpoints de diagnóstico
- `/.netlify/functions/diag-require`: valida **módulos** (locales y npm) en runtime.
- `/.netlify/functions/diag-env`: valida **ENV** (marca `(set)` / `(MISSING)` sin exponer secretos).
- Útiles para diferenciar “problema de bundle/runtime” vs “problema de lógica”.

## 18) Comandos `curl` útiles
```bash
# 1) Ver módulos
curl -s "https://<sitio>.netlify.app/.netlify/functions/diag-require" -H "x-debug: 1" | jq .

# 2) Ver ENV esenciales
curl -s "https://<sitio>.netlify.app/.netlify/functions/diag-env" -H "x-debug: 1" | jq .

# 3) Forzar modo depuración del handler (devuelve JSON en fallos de boot)
curl -i "https://<sitio>.netlify.app/.netlify/functions/autopick-vip-nuevo?debug=1" \
  -H "x-auth-code: $AUTH_CODE" \
  -H "x-debug: 1" \
  -H "cache-control: no-cache"

# 4) Interpretación de 500 opaco
# Copia el ID de x-nf-request-id del 500 y abre el log del deploy en Netlify.
19) netlify.toml (resumen de bundling)
node_bundler = "esbuild" (recomendado).

external_node_modules: incluir openai, @supabase/supabase-js, node-fetch si tu helper lo requiere.

Funciones: ruta netlify/functions.

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
curl -i "https://<tu-sitio>.netlify.app/.netlify/functions/autopick-vip-nuevo?debug=1" \
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

30) Errores que ya vimos y cómo se solucionaron
Identifier 'CICLO_ID' has already been declared / Identifier 'started' ... / Identifier 'gotLock' ...
Causa: bloques duplicados al pegar la cabecera/locks.
Solución: deja un solo bloque 2.1 y 2.3 (arriba) y elimina duplicados.

Unexpected end of input (p.ej. línea ~1838)
Causa: faltaba cerrar try/catch/finally tras recortes parciales.
Solución: conserva el finally completo del final del handler (liberar locks + logs).

Internal Error. ID: ... desde Netlify (opaco)
Causa: excepción fuera de nuestros try/catch de ciclo (arranque).
Solución: boot defensivo de 2.1; en modo debug devuelve JSON legible en lugar de 500 opaco.

Descartes masivos STRICT_MATCH=1 → sin AF.fixture_id
Causa: resolver AF no encuentra fixture inequívoco para ciertos eventos.
Solución: revisar normalización en af-resolver.cjs, ajustar MATCH_RESOLVE_CONFIDENCE, mantener prohibido usar listas fijas o partidos simulados.

31) Pruebas manuales (sin partidos simulados)
Verifica módulos/ENV en runtime:

bash
Copiar
Editar
curl -s "https://<sitio>.netlify.app/.netlify/functions/diag-require" -H "x-debug: 1" | jq .
curl -s "https://<sitio>.netlify.app/.netlify/functions/diag-env" -H "x-debug: 1" | jq .
Llama al handler en modo depuración (usa eventos reales de OddsAPI):

bash
Copiar
Editar
curl -i "https://<sitio>.netlify.app/.netlify/functions/autopick-vip-nuevo?debug=1" \
  -H "x-auth-code: $AUTH_CODE" \
  -H "x-debug: 1" \
  -H "cache-control: no-cache"
Si regresa 500 con Internal Error. ID: <...>, copia el ID y abre el log del deploy correspondiente en Netlify para ver el stack.
Si debug=1 está activo y el error ocurre en boot, recibirás JSON con stage:"boot" y mensaje.

32) Recordatorios de reglas del proyecto (se mantienen)
No usar nombres fijos de equipos ni whitelists/blacklists estáticas.

No correr tests con partidos simulados; sólo eventos reales (OddsAPI).

STRICT_MATCH=1 está permitido (y recomendable) para evitar falsos matches.

33) Bloque finally recomendado (copia textual)
js
Copiar
Editar
} catch (e) {
  console.error('❌ Excepción en ciclo principal:', e?.message || e);
  const body = debug
    ? JSON.stringify({ ok: false, error: e?.message || String(e) })
    : JSON.stringify({ ok: false });
  return { statusCode: 200, body: body };
} finally {
  try { await releaseDistributedLock(); } catch(_) {}
  global.__punterx_lock = false;
  try { await upsertDiagnosticoEstado('idle', null); } catch(_) {}

  logger.section('Resumen ciclo');
  logger.info('Conteos:', JSON.stringify(resumen));
  logger.info('Causas de descarte:', JSON.stringify(causas));
  const top = Object.entries(causas).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}:${v}`).join(' | ');
  logger.info('Top causas:', top || 'sin descartes');

  console.log(`🏁 Resumen ciclo: ${JSON.stringify(resumen)}`);
  console.log(`Duration: ${(Date.now()-started).toFixed(2)} ms...Memory Usage: ${Math.round(process.memoryUsage().rss/1e6)} MB`);
}
Fin del documento.
