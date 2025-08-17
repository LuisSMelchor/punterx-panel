# PunterX-Config.md
> **Estado:** en integración activa (Node 20).  
> **Objetivo central:** detectar y publicar *picks* de alto valor (“pick mágico”) de forma **global**, sin listas fijas de equipos o ligas, y respetando el **contrato de mensajes** ya definido (no modificar formatos ni plantillas de salida).

---

## 1) Qué es PunterX (visión y principios)
- **Cobertura global** de fútbol usando **OddsAPI** como fuente de mercados en pre-match.  
- **Ventana de publicación**: se busca publicar **~45 min** antes del kickoff (con fallback ampliado) para disponer de la **información crítica de API-FOOTBALL (alineaciones, contexto, etc.)**.  
- **Emparejamiento automático (matching)** entre eventos de OddsAPI y fixtures de API-FOOTBALL, **sin nombres fijos** ni listas predefinidas.  
- **Mensajería inmutable**: los formatos de mensajes a Telegram (FREE/VIP) **no se tocan**.  
- **IA**: se usa OpenAI para generar análisis/estructura del pick, con **guardrails** (no_pick, rango de probabilidad, coherencia con cuota, EV).  
- **Señal de mercado**: snapshots históricos de mejores cuotas para detectar movimiento (odds_prev_best) y alimentar **Corazonada IA**.  
- **No hay “equipos fijos” ni “ligas fijas”**: cualquier lógica que sugiera listas o banderas rígidas se considera **desvío del proyecto**.

---

## 2) Componentes actuales
- **`netlify/functions/autopick-vip-nuevo.cjs`**  
  - Orquestador del ciclo:  
    - llama a **OddsAPI** (mercados `h2h, totals, spreads`),  
    - normaliza eventos,  
    - filtra por ventana temporal,  
    - enriquece con **API-FOOTBALL** (fixture, país, liga, venue, clima si disponible),  
    - genera **prompt** con opciones **apostables reales** extraídas de OddsAPI,  
    - llama OpenAI (modelo + fallback),  
    - valida pick (probabilidad, coherencia, EV),  
    - **opcionalmente** guarda snapshot de cuotas + calcula **Corazonada IA**,  
    - **envía mensajes** a Telegram **respetando el formato existente**,  
    - guarda el pick en Supabase.
  - **Locks**: lock en memoria + **lock distribuido** en tabla `px_locks`.
  - **Diagnóstico**: upsert estado en `diagnostico_estado` + inserciones en `diagnostico_ejecuciones`.

- **`_lib/af-resolver.cjs`**  
  - Helper para seleccionar el mejor fixture entre múltiples candidatos de API-FOOTBALL.

- **`_lib/match-helper.cjs`** *(carga segura)*  
  - Debe exponer `resolveTeamsAndLeague(...)` (opcional, si existe), ayudando a normalizar nombres y liga **sin hardcodear** equipos.

- **`_corazonada.cjs`**  
  - Expone `computeCorazonada({ pick, oddsNow, oddsPrev, xgStats, availability, context })`.

- **`prompts_punterx.md`**  
  - Plantilla de prompt. Se usa la sección **“1) Pre-match”** si está disponible.

---

## 3) Variables de entorno (Node 20)
> **Obligatorias**
- `SUPABASE_URL`, `SUPABASE_KEY`
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_GROUP_ID`
- `ODDS_API_KEY`
- `API_FOOTBALL_KEY`

> **Modelos**
- `OPENAI_MODEL` (por defecto: `gpt-5-mini`)
- `OPENAI_MODEL_FALLBACK` (por defecto: `gpt-5`)

> **Ventanas / filtros**
- `WINDOW_MAIN_MIN` (default **45**)  
- `WINDOW_MAIN_MAX` (default **55**)  
- `WINDOW_FB_MIN` (default **35**)  
- `WINDOW_FB_MAX` (default **70**)  
- `SUB_MAIN_MIN` (default **45**)  
- `SUB_MAIN_MAX` (default **55**)

> **Ciclo / presupuesto**
- `PREFILTER_MIN_BOOKIES` (default 2)  
- `MAX_CONCURRENCY` (default 6)  
- `MAX_PER_CYCLE` (default 50)  
- `SOFT_BUDGET_MS` (default 70000)  
- `MAX_OAI_CALLS_PER_CYCLE` (default 40)

> **Flags**
- `STRICT_MATCH` (`"1"` exige match AF para continuar)  
- `DEBUG_TRACE` (`"1"` imprime trazas de matching)

> **Corazonada / snapshots**
- `CORAZONADA_ENABLED` (default `"1"`)  
- `ODDS_PREV_LOOKBACK_MIN` (default **7**) — *lookback* (min) para `odds_prev_best`.

> **Presentación**
- `COUNTRY_FLAG` (se recomienda **retirar banderas** y mostrar solo país+liga)

> **(Propuesta en curso, ver “Soluciones en marcha”)**  
- `ODDS_REGIONS` (ej: `us,uk,eu,au,…`) para reemplazar la región fija del endpoint.

---

## 4) Fuentes de datos
- **OddsAPI**  
  - Endpoint actual: `/v4/sports/soccer/odds/?regions=eu,us,uk&oddsFormat=decimal&markets=h2h,totals,spreads`  
  - **Nota**: En curso refactor para tomar **todas las regiones soportadas** vía `ODDS_REGIONS` (sin hardcode).

- **API-FOOTBALL (AF)**  
  - Se usa para **fixture match** + **contexto** (país, liga, venue, clima cuando exista) y para alimentar builders de `xgStats`, `availability`, `context`.  
  - **Clave**: el pick **sí** depende de AF para la ventana objetivo (alineaciones/contexto). El sistema **no debe** degradarse a un pick sin AF en la ventana principal.

---

## 5) Tablas (Supabase)

> ### `px_locks`
| columna     | tipo      | notas                      |
|-------------|-----------|----------------------------|
| `lock_key`  | text PK   | ej. `autopick_vip_nuevo`   |
| `expires_at`| timestamptz | manejo de TTL             |

> ### `diagnostico_estado`
| columna     | tipo        | notas                         |
|-------------|-------------|-------------------------------|
| `fn_name`   | text PK     | `autopick-vip-nuevo`          |
| `status`    | text        | `running` / `idle`            |
| `details`   | jsonb/null  | info adicional                |
| `updated_at`| timestamptz | `now()`                       |

> ### `diagnostico_ejecuciones`
| columna        | tipo        | notas                     |
|----------------|-------------|---------------------------|
| `function_name`| text        |                           |
| `created_at`   | timestamptz | `now()`                   |
| …              | …           | campos libres de auditoría|

> ### `picks_historicos`
| columna        | tipo       | notas                                             |
|----------------|------------|---------------------------------------------------|
| `evento`       | text       | `home vs away (liga)`                             |
| `analisis`     | text       | FREE + VIP (concatenado con separador)            |
| `apuesta`      | text       | literal desde opciones apostables                 |
| `tipo_pick`    | text       | `VIP`/`FREE`                                      |
| `liga`         | text       |                                                   |
| `pais`         | text/null  |                                                   |
| `equipos`      | text       | `home — away`                                     |
| `ev`           | numeric    | % EV                                              |
| `probabilidad` | numeric    | %                                                 |
| `nivel`        | text       | clasificación por EV                              |
| `timestamp`    | timestamptz| `now()`                                           |
| `top3_json`    | jsonb null | (opcional) top-3 bookies del mercado seleccionado |

> ### `odds_snapshots`
| columna        | tipo        | notas                                                                 |
|----------------|-------------|-----------------------------------------------------------------------|
| `id`           | bigint PK   | autoincrement                                                         |
| `event_key`    | text        | `OddsAPI.id` o compose                                                |
| `fixture_id`   | int null    | `AF.fixture.id` si disponible                                         |
| `market`       | text        | `h2h` \| `totals` \| `spreads` (mapeo desde la “apuesta”)             |
| `outcome_label`| text        | etiqueta literal (la “apuesta” seleccionada)                          |
| `point`        | numeric null| punto del total/hándicap si aplica                                    |
| `best_price`   | numeric     | mejor cuota en el momento                                             |
| `best_bookie`  | text null   | bookie líder cuando se conoce                                         |
| `top3_json`    | jsonb null  | arreglo de `{bookie, price, ...}`                                     |
| `captured_at`  | timestamptz | **DEFAULT `now()`** (el código actual no envía esta columna explícita) |

> **Índices recomendados (`odds_snapshots`)**
- `(event_key, market, outcome_label, point, captured_at DESC)`  
- `(fixture_id)` *(opcional, cuando exista)*

---

## 6) Contratos y restricciones (NO ROMPER)
- **No hardcodear equipos/ligas**: queda prohibido mantener listas fijas (ej. UNAM, Toluca, Querétaro, etc.).  
- **Mensajería**: **no cambiar** plantillas, emojis, orden, ni textos de encabezado/cuerpo en los mensajes FREE y VIP.  
- **Match obligatorio en ventana principal**: en 45–55 (y subventana) el flujo **debe** intentar AF; `STRICT_MATCH=1` puede **bloquear** picks sin AF.  
- **Opciones apostables reales**: la **“apuesta”** debe ser **exactamente** una de las opciones listadas desde OddsAPI para el evento.

---

## 7) Cómo funciona el matching (resumen)
1. **Normalización** de nombres (sin listas fijas): eliminación de acentos, partículas comunes (fc/cf/sc/club/…).
2. **Búsqueda AF**:
   - por **league+date** (si la liga es mapeable),  
   - por **league±2d**,  
   - por **search(home+away)** y, si no hay candidatos, **search individual** por equipo,  
   - como último recurso, **IDs de equipos** + `h2h` en ventana temporal.
3. **Selección del mejor fixture** por similitud de nombres y cercanía temporal.  
4. **Propagación** de `pais`/`liga` y metadatos del fixture a la instancia del evento normalizado.

> **Nota sobre `AF_LEAGUE_ID_BY_TITLE`:**  
Lista de ejemplo que se introdujo como apoyo. **No es la vía correcta**: rompe el principio de *no hardcodeo*. Ver “Hallazgos y desvíos”.

---

## 8) Corazonada IA + odds_prev_best
- **Ahora:**  
  - se guarda un snapshot por pick evaluado (`odds_snapshots`),  
  - se puede recuperar `odds_prev_best` con **lookback** (`ODDS_PREV_LOOKBACK_MIN`, default 7 min),  
  - `computeCorazonada` recibe `oddsNow.best` y `oddsPrev.best` además de `xg/availability/context`.  
- **Uso esperado:**  
  - detectar **tendencias** (drift) y reforzar/penalizar el *score* cualitativo.

---

## 9) Observabilidad
- **Logs clave** en el ciclo:  
  - cuenta de eventos recibidos, filtrados, en ventana,  
  - trazas de matching AF (**DEBUG_TRACE**),  
  - métricas de llamadas OpenAI y motivos de `no_pick`,  
  - resumen con `procesados`, `descartados_ev`, `enviados_*`, `af_hits/af_fails`.

---

## 10) Hallazgos y **desvíos detectados** (diagnóstico)
1. **Hardcode de ligas** — `AF_LEAGUE_ID_BY_TITLE`  
   - Aunque útil para *boost* de precisión, **viola la regla** “sin listas fijas”.  
   - Riesgo: perder fixtures de ligas no listadas o mal mapeadas.

2. **Banderas por país**  
   - `COUNTRY_FLAG` agrega una bandera estática. **No es deseable** por política de neutralidad; país+liga es suficiente.

3. **Regiones de OddsAPI fijas**  
   - Endpoint usa `regions=eu,us,uk` en duro. **Podemos perder disponibilidad de bookies** de otras regiones soportadas.

4. **Dependencia de AF en ventana**  
   - La intención del proyecto es **sí depender** de AF en la ventana principal (alineaciones, etc.).  
   - En los logs adjuntos se vieron **ciclos con `af_fails=1`** → la función cayó en **`no_pick`** o “Pick incompleto”, lo que **está bien** como guardrail; pero debemos asegurar que la búsqueda AF sea **robusta y *general*** (sin ejemplo de nombres fijos).

5. **Mensajería**  
   - Se respeta el **formato actual** (VIP/FREE). En versiones previas se propusieron cambios cosméticos; **se descartan**. El **contrato de mensajes es inmutable**.

6. **Snapshots**  
   - El insert **no incluye** `captured_at`; la tabla debe definir **DEFAULT `now()`** (esto está documentado aquí).

7. **Timeouts/`finish_reason: length` en OpenAI**  
   - Varios logs con *length*. El fallback repite la petición con mayor `max_completion_tokens`. Guardrail activo.

8. **STRICT_MATCH**  
   - Si está activo (`1`), y AF falla, el pick se **descarta** antes de IA/Telegram. Alinear la configuración con la estrategia de ventana.

---

## 11) **Soluciones en marcha** (sin romper contratos)
> *Aquí listamos lo que ya se está implementando o queda aprobado para implementar; no cambia formatos de mensajes ni introduce listas fijas.*

1. **Eliminar banderas**  
   - Configurar `COUNTRY_FLAG` vacío o quitar su uso en el render. Mantener “País — Liga”.

2. **Regiones dinámicas en OddsAPI**  
   - Introducir `ODDS_REGIONS` (ej: `us,uk,eu,au,za,br,ar,...`) y usarlo en el endpoint (reemplaza el hardcode actual).  
   - Objetivo: **no perder partidos apostables** por regionado incompleto.

3. **Matching AF totalmente general**  
   - Mantener el pipeline multi-estrategia (league+date, league±2d, search global e individual, ids+h2h) **sin AF lists**.  
   - `AF_LEAGUE_ID_BY_TITLE` queda **deprecado** (y se eliminará).  
   - Se sigue usando normalización **genérica** (acentos/stopwords), no listas.

4. **Ventanas más tolerantes sin perder el foco**  
   - Mantener **45–55** como ventana principal; permitir **fallback** más ancho (ya existe 35–70).  
   - Ajustes se hacen por **ENV** (no en código) para mitigar “partidos perdidos”.

5. **Snapshots y Corazonada**  
   - Confirmada la escritura **por pick** y el lookup con `lookback` (7 min por defecto).  
   - Documentado el esquema y los índices recomendados.

6. **Contrato de mensajes**  
   - Se mantiene **intacto**. Cualquier nueva metainformación (ej. *score* de Corazonada) **solo si ya está contemplada** por el formato actual; si no, se omite.

---

## 12) Errores conocidos (y su estado)
- **“Sin coincidencias en API-Football”** en algunos ciclos  
  - *Estado:* en diagnóstico; se reforzó el matching general, sin listas fijas.  
  - *En curso:* ampliar búsqueda y normalización; medir recall sin `AF_LEAGUE_ID_BY_TITLE`.

- **OpenAI `finish_reason: length` y “Pick incompleto tras fallback”**  
  - *Estado:* mitigado por reintento con más tokens; guardrail mantiene `no_pick` si el JSON no es válido.

- **Partidos fuera de ventana por redondeos/latencia**  
  - *Estado:* ventana fallback activa; *tuning* por ENV.

- **Banderas en encabezado**  
  - *Estado:* se retiran; dejar país + liga.

---

## 13) Seguridad y límites
- **Rate limiting**: `fetchWithRetry` con reintentos y `Retry-After`.  
- **Presupuesto**: `SOFT_BUDGET_MS` y `MAX_OAI_CALLS_PER_CYCLE`.  
- **Locks**: tabla `px_locks` evita carreras en despliegue serverless.

---

## 14) Checklist de despliegue
- [ ] Variables obligatorias presentes.  
- [ ] `odds_snapshots.captured_at` con `DEFAULT now()`.  
- [ ] `ODDS_REGIONS` definido (migración del endpoint).  
- [ ] `STRICT_MATCH` acorde a estrategia (1 si se exige AF en ventana).  
- [ ] `COUNTRY_FLAG` vacío (o no usado) para evitar banderas.  
- [ ] Índices de `odds_snapshots` creados.  
- [ ] `picks_historicos.top3_json` existe (si no, insertar sin el campo).

---

## 15) Resumen ejecutivo
- **Nos salimos del rumbo** cuando aparecieron *hardcodes* (p. ej. `AF_LEAGUE_ID_BY_TITLE`) y banderas fijas: eso **contradice** la cobertura **100% general**.  
- El **pick sí depende de AF** en la ventana principal; el sistema **no debe** publicar si AF no cuadra (cuando `STRICT_MATCH=1`).  
- **Acciones**: retirar banderas, parametrizar regiones de OddsAPI, suprimir listas fijas de ligas, reforzar matching completamente **general** y mantener **intacto** el formato de mensajes.

> **Conclusión:** el código actual **ya respeta** gran parte del flujo (ventanas, IA con guardrails, snapshots, mensajería). Los desvíos detectados (ligas/flags fijas, regiones hardcodeadas) están documentados y **en proceso de corrección** **sin alterar** los contratos de salida ni introducir dependencias estáticas.

---
