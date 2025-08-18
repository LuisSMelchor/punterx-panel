PunterX — Configuración, Flujo y Libro de Ruta

Versión: 2025-08-17 · Responsable: Luis + Dev Senior PunterX
Ámbito: Soccer global (pre-match y outrights). Live preparado pero en pausa por costos de OddsAPI.

1) Propósito y principio rector

Objetivo: detectar y publicar picks “mágicos” (alto EV real) en todos los partidos apostables del mundo, sin listas fijas, con enriquecimiento avanzado y guardrails de IA.
Principio: cobertura 100% general (sin ligas/IDs hardcode), ventana principal 45–55 min antes del inicio (alineaciones y signals listas), y STRICT_MATCH=1: si OddsAPI y API-FOOTBALL no cuadran, no se publica.

2) Estado actual (resumen ejecutivo)

✅ Cobertura global restaurada: sin hardcodes de ligas/IDs; regiones de OddsAPI ahora parametrizadas.

✅ STRICT_MATCH=1 vigente: si AF no resuelve fixture/league limpio en ventana principal → descartado antes de IA.

✅ Mensajería (canal & VIP) intacta con branding aprobado (liga con país, “Comienza en X minutos aprox”, Top-3 bookies, etc.).

✅ Live: código listo y coherente; pausado en Replit por costo de llamadas (se reactivará cuando suba el plan).

✅ Corazonada IA integrada (pesos por disponibilidad, contexto, mercado, xG) y snapshots de cuotas.

✅ Node y CommonJS consolidados; evitamos ESM y backticks problemáticos en URLs.

🔄 Diagnóstico V2 (UI HTML): en avance.

🔄 Memoria IA (Supabase → prompt): activo y por optimizar (resumen compacto + relevancia por equipo/liga/mercado).

🔄 Outrights: alineados conceptualmente; afinando coherencias y thresholds finales.

3) Arquitectura (alto nivel)

Netlify Functions (serverless)

autopick-vip-nuevo.cjs → orquestador pre-match (cada 15 min).

autopick-outrights.cjs → outrights con mismas validaciones.

autopick-live.cjs → live preparado (pausado).

_lib/* → resolvers y utilidades (resolver AF, normalizaciones, odds helpers, etc.).

send.js → Telegram (canal & VIP).

diagnostico-total.js (+ _diag-core-v4.cjs) → panel y métricas.

_corazonada.cjs, _telemetry.cjs, _supabase-client.cjs.

Fuentes

OddsAPI → mercados reales (h2h, totals, spreads).

API-FOOTBALL (PRO) → fixtures, alineaciones, árbitro, clima, forma, xG, lesiones, historial.

OpenAI (GPT-5) → análisis y JSON final (una llamada / partido, con fallback).

Persistencia (Supabase)

picks_historicos (+ memoria IA y diagnósticos), odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones.

4) Flujo maestro (pre-match)

OddsAPI: obtener todos los eventos con cuotas (regiones parametrizadas).

Filtro temporal: ventana principal 45–55 min (fallback 35–70 min si aplica, sin violar STRICT_MATCH).

Resolver AF: matching completamente general (liga/país/equipos/fecha). STRICT_MATCH=1 → si no cuadra, descartado.

Construcción del prompt: opciones apostables reales (lo que trae OddsAPI), + contexto AF (alineaciones, lesiones, clima, árbitro, forma, xG, historial), + memoria IA resumida si aplica.

OpenAI: una llamada (con fallback) → un único JSON con: apuesta, probabilidad, analisis_free, analisis_vip, no_pick, frases, apuestas_extra, etc.

Validaciones (ver §10): rango probabilidad, coherencia con probabilidad implícita, EV mínimo, outcome válido y top-3 bookies coherente.

Clasificación por EV → Canal FREE (10–14.9%) / VIP (≥15%) con niveles.

Mensajería Telegram (formato aprobado).

Guardado en Supabase (+ odds snapshots y memoria IA).

Telemetría (locks, diagnósticos, contadores).

5) Ventanas y tiempos

Ventana principal pre-match: 45–55 min antes de inicio.

Fallback: 35–70 min (solo si corresponde y sin saltarse STRICT_MATCH).

Cron maestro: cada 15 min (Netlify).

Zona horaria: America/Mexico_City (en ENV TZ).

6) IA y guardrails

1 llamada a OpenAI por evento (con reintento corto).

no_pick=true → corta el flujo.

Probabilidad IA: 5%–85%.

Coherencia con probabilidad implícita (cuota elegida) ≤ 15 p.p.

Apuesta válida: debe existir en outcomes reales del evento (OddsAPI) y encontrarse la cuota exacta para el cálculo EV.

Top-3 bookies: ordenado por cuota; mejor en negritas (VIP).

Corazonada IA: señal cualitativa basada en pesos ajustables (ver §13).

7) Cálculo EV y clasificación

EV calculado con la probabilidad estimada por IA vs. probabilidad implícita de la cuota elegida.

Umbrales:

VIP: EV ≥ 15%

🟣 Ultra Élite: ≥ 40%

🎯 Élite Mundial: 30–39.9%

🥈 Avanzado: 20–29.9%

🥉 Competitivo: 15–19.9%

FREE (📄 Informativo): 10–14.9%

No guardar picks con EV < 10% ni con datos incompletos.

8) Mensajería (formatos aprobados)

Canal gratuito (@punterxpicks)

Encabezado: 📡 RADAR DE VALOR

Incluye: liga (con país), equipos, hora (“Comienza en X minutos aprox”), análisis breve de IA, frase motivacional, CTA al VIP, disclaimer responsable.

No incluye la apuesta sugerida.

Grupo VIP (-1002861902996)

Encabezado: 🎯 PICK NIVEL: [Ultra/Élite/Avanzado/Competitivo]

Incluye: liga (con país), equipos, hora de inicio, EV y probabilidad;
Apuesta sugerida + Apuestas extra (Más de 2.5, Ambos anotan, Doble oportunidad, Goleador, Marcador exacto, HT result, Hándicap asiático);
Top 3 bookies (mejor en negritas), Datos avanzados (clima, árbitro, lesiones, historial, xG), Corazonada IA (si aplica), disclaimer responsable.

Frase final (todas las piezas):
“🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.”

9) Integraciones y variables de entorno

Ya definidas en Netlify (tus valores):
API_FOOTBALL_KEY, AUTH_CODE, AWS_LAMBDA_JS_RUNTIME, CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG, ENABLE_OUTRIGHTS, ENABLE_OUTRIGHTS_INFO, LIVE_COOLDOWN_MIN, LIVE_MARKETS, LIVE_MIN_BOOKIES, LIVE_POLL_MS, LIVE_PREFILTER_GAP_PP, LIVE_REGIONS, MATCH_RESOLVE_CONFIDENCE, MAX_OAI_CALLS_PER_CYCLE, NODE_OPTIONS, NODE_VERSION, ODDS_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK, OUTRIGHTS_COHERENCE_MAX_PP, OUTRIGHTS_EV_MIN_VIP, OUTRIGHTS_EXCLUDE, OUTRIGHTS_MIN_BOOKIES, OUTRIGHTS_MIN_OUTCOMES, OUTRIGHTS_PROB_MAX, OUTRIGHTS_PROB_MIN, PANEL_ENDPOINT, PUNTERX_SECRET, RUN_WINDOW_MS, SUB_MAIN_MAX, SUB_MAIN_MIN, SUPABASE_KEY, SUPABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID, TZ, WINDOW_FALLBACK_MAX, WINDOW_FALLBACK_MIN, WINDOW_FB_MAX, WINDOW_FB_MIN, WINDOW_MAIN_MAX, WINDOW_MAIN_MIN, WINDOW_MAX, WINDOW_MIN.

Agregadas / confirmadas (corrección de rumbo):

ODDS_REGIONS=us,uk,eu,au ← nuevo (cobertura global por defecto).

STRICT_MATCH=1 ← nuevo (descarta si AF no cuadra).

LIVE_REGIONS ya existía; ahora no se redeclara y se usa como fallback si falta ODDS_REGIONS.

Nota Live: Pese a tener LIVE_REGIONS, Live está pausado en Replit por costos. Este doc solo deja el código coherente y listo.

10) Reglas de guardado (validadas antes de insertar)

no_pick === true → descartar.

Integridad: apuesta, probabilidad, analisis_free, analisis_vip presentes.

Apuesta válida y cuota exacta encontrada en outcomes OddsAPI.

Probabilidad IA en rango 5–85%.

Coherencia |P(IA) − P(implícita cuota)| ≤ 15 p.p.

EV ≥ 10% para guardar; VIP solo si EV ≥ 15%.

Anti-duplicado por evento (pre-match) y por torneo (outrights).

Top-3 bookies adjunto (si existe la columna top3_json).

Mensajes formateados según reglas (ver §8) y liga con país.

11) Anti-duplicado y locks

Anti-duplicado: búsqueda en picks_historicos por evento (y para outrights por torneo).

Lock distribuido (px_locks) con TTL por ciclo para evitar dobles envíos simultáneos (Netlify overlapping).

12) Supabase: tablas y esquema recomendado
picks_historicos (base central de memoria y auditoría)

evento (text)

analisis (text) → incluir FREE+VIP (o campos separados si ya migrado)

apuesta (text)

tipo_pick (text: 'VIP' | 'FREE')

liga (text)

equipos (text)

ev (numeric)

probabilidad (numeric)

nivel (text: 🟣/🎯/🥈/🥉/📄)

timestamp (timestamptz)

top3_json (jsonb) ← recomendado

SQL idempotente sugerido (si faltara top3_json):

alter table if exists public.picks_historicos
  add column if not exists top3_json jsonb;

Otras tablas

odds_snapshots (historial de mejor cuota por evento/mercado para señales de mercado + corazonada).

px_locks (key, ttl, created_at).

diagnostico_estado (estado resumido para el panel).

diagnostico_ejecuciones (contadores por etapa por ciclo).

13) Corazonada IA (señal cualitativa)

Variables:
CORAZONADA_ENABLED (0/1),
CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG (pesos).

Inputs: disponibilidad de datos AF (alineaciones, lesiones), contexto matchup (forma, historial), señales de mercado (cambios en cuotas/snapshots), xG/estadísticas.

Salida: texto breve + (opcional) score interno; se muestra en VIP si disponible.

14) Outrights (alineado a pre-match)

Misma filosofía: sin listas fijas de ligas/torneos; resolver AF por búsqueda textual/season vigente.

Validaciones: outcomes reales; prob. IA 5–85%; coherencia ≤ 15 p.p.; EV ≥ umbral (OUTRIGHTS_EV_MIN_VIP para VIP).

Anti-duplicado por torneo; Top-3 bookies si aplica.

15) Live (preparado, en pausa)

Motivo de pausa: alto consumo de llamadas a OddsAPI desde Replit (costos).

Estado del código: coherente con regiones parametrizadas; sin redeclaraciones de LIVE_REGIONS; URLs usando regions=${encodeURIComponent(LIVE_REGIONS)}.

Reactivación futura: aumentar plan en OddsAPI + (opcional) rate-limit y ENABLE_LIVE (switch simple).

16) Diagnóstico y observabilidad

Diagnóstico V2 (HTML): mostrar estado de APIs, locks, picks recientes, errores, consumo básico y señales de mercado.

Telemetría mínima por ciclo:

Consultas realizadas (OddsAPI/AF), picks candidatos, IA llamadas (OK/fallback), clasificados (FREE/VIP), descartados (causa), guardados y enviados.

17) Seguridad, estilo y despliegue

CommonJS (.cjs) siempre; sin ESM ni top-level await.

Variables sensibles solo por ENV (Netlify).

Sin hardcodes de ligas/IDs/regiones.

Backups antes de cambios amplios; diffs mínimos cuando sean correcciones puntuales.

Documentación sincronizada: cualquier cambio de lógica/vars debe reflejarse aquí y en PunterX-Config.md.

18) Cambios aplicados hoy (2025-08-17)

Corrección de rumbo (Resumen Ejecutivo #15):

✅ Eliminados mapeos estáticos tipo AF_LEAGUE_ID_BY_TITLE y similares.

✅ Parametrizadas regiones de OddsAPI: ODDS_REGIONS (default us,uk,eu,au) y uso de LIVE_REGIONS como fallback.

✅ STRICT_MATCH=1 activado y reforzado: mismatch AF → no IA, no EV, no envío.

✅ autopick-live.cjs: se eliminó la doble declaración de LIVE_REGIONS y se reemplazaron literales regions=uk por ${encodeURIComponent(LIVE_REGIONS)}.

✅ autopick-vip-nuevo.cjs: reemplazo de construcción de URL con concatenación clásica para evitar errores de backticks; regions= ahora usa ODDS_REGIONS.

✅ Env en Netlify: añadidos ODDS_REGIONS y STRICT_MATCH.

✅ Mensajería intacta y verificada (liga con país; “Comienza en X minutos aprox”; Top-3; frase final nueva).

19) Roadmap inmediato (qué sigue)

Diagnóstico V2 (UI HTML) con _diag-core-v4.cjs:

Estado de APIs, locks, picks recientes, causas de descarte (coherencia, rango prob., no outcome, no_pick, etc.).

Memoria IA:

Recuperación por equipo/liga/mercado últimos N picks; resumen compacto para el prompt (budget tokens).

Registro ex-post para realimentación (win/loss, error drivers).

Outrights:

Afinar coherencia y umbral EV VIP con las mismas reglas que pre-match; anti-duplicado por torneo.

Costos:

Límite de llamadas a OpenAI por ciclo (ya hay MAX_OAI_CALLS_PER_CYCLE), y backoff si OddsAPI/AF fallan.

Live (cuando aumente el plan):

Re-enable con rate-limit (LIVE_POLL_MS, LIVE_COOLDOWN_MIN) y switch opcional ENABLE_LIVE.

20) Checklist de despliegue (cada cambio)

 ENV en Netlify actualizadas (ODDS_REGIONS, STRICT_MATCH, LIVE_REGIONS si aplica).

 Sin hardcodes en regions=; todo via ${encodeURIComponent(…REGIONS)}.

 STRICT_MATCH corta antes de IA/EV/enviar.

 Mensajes siguen el formato aprobado.

 Supabase: columnas presentes (incl. top3_json).

 Logs/diagnóstico sin errores (data.find is not a function, etc.).

21) secrets.env.example (plantilla)

No poner valores reales.

# APIs
ODDS_API_KEY=
API_FOOTBALL_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
OPENAI_MODEL_FALLBACK=gpt-4o-mini

# Supabase
SUPABASE_URL=
SUPABASE_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
TELEGRAM_GROUP_ID=

# Panel
PANEL_ENDPOINT=
PUNTERX_SECRET=

# Tiempo/ventanas (ejemplos)
TZ=America/Mexico_City
WINDOW_MAIN_MIN=45
WINDOW_MAIN_MAX=55
WINDOW_FALLBACK_MIN=35
WINDOW_FALLBACK_MAX=70

# OddsAPI regiones (global por defecto)
ODDS_REGIONS=us,uk,eu,au
LIVE_REGIONS=us,uk,eu,au

# Matching estricto
STRICT_MATCH=1

# IA
MAX_OAI_CALLS_PER_CYCLE=20

# Corazonada
CORAZONADA_ENABLED=1
CORAZONADA_W_AVAIL=0.25
CORAZONADA_W_CTX=0.25
CORAZONADA_W_MARKET=0.25
CORAZONADA_W_XG=0.25

22) Errores frecuentes y soluciones rápidas

“Identifier 'LIVE_REGIONS' has already been declared”
→ Deja una sola declaración (const LIVE_REGIONS = process.env.LIVE_REGIONS || process.env.ODDS_REGIONS || 'us,uk,eu,au') y elimina cualquier reasignación.

“Unexpected identifier '$'” en URLs
→ Evitar backticks; usar concatenación o new URL(...).

data.find is not a function
→ Normalizar entradas: const arr = Array.isArray(data) ? data : [];

Pick con apuesta no válida
→ Verificar apuesta ∈ outcomes y selección de cuota exacta via helper; si no existe, descartar.

Coherencia > 15 p.p.
→ Descartar; revisar que la cuota leída sea la del mercado exacto.

Duplicados
→ Confirmar anti-duplicado por evento (pre-match) o torneo (outrights).

23) Nota final (mantenimiento de doc)

Cada cambio en código, variables o lógica debe reflejarse aquí y en PunterX-Config.md para mantener la documentación sincronizada.
Estilo: Español; formato Resumen → Acción → Detalle; CommonJS; sin claves reales.
Meta: fortalecer el sistema para encontrar picks de oro con valor real, listos para VIP.

Fin de punterx.md.
