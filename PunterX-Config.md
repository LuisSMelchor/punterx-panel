PunterX-Config.md

Versión: 2025-08-17
Responsables: Luis Sánchez (owner) · Dev Senior PunterX
Ámbito actual: Fútbol (soccer) global — pre-match y outrights. Live preparado pero en pausa por costos de OddsAPI.

1) Propósito y principio rector

Objetivo: detectar y publicar picks “mágicos” (alto EV real) en todos los partidos apostables del mundo, sin listas fijas, con enriquecimiento avanzado (API-FOOTBALL PRO) y guardrails de IA.
Principios innegociables:

Cobertura 100% general: sin ligas/IDs hardcode ni whitelists.

Ventana principal: 45–55 min antes del inicio (alineaciones, señales y contexto listos).

STRICT_MATCH=1: si OddsAPI y API-FOOTBALL no cuadran con el fixture real en ventana principal, no se publica.

2) Estado actual (resumen ejecutivo)

✅ Corrección de rumbo aplicada (Resumen Ejecutivo #15): se eliminaron mapeos estáticos tipo AF_LEAGUE_ID_BY_TITLE y cualquier dependencia fija de liga/ID/país.

✅ Regiones OddsAPI parametrizadas: ahora con ODDS_REGIONS (default us,uk,eu,au) y fallback a LIVE_REGIONS si faltara.

✅ STRICT_MATCH=1 activo: mismatch AF → descartado antes de IA y EV.

✅ Fix de build/URLs: se reemplazaron template strings problemáticos por concatenación clásica o URL nativa al armar endpoints (evita “Unexpected identifier '$'”).

✅ Fix Live: una única declaración de LIVE_REGIONS y URLs live usando regions=${encodeURIComponent(LIVE_REGIONS)}.

✅ Nuevo ODDS_SPORT_KEY: control explícito del deporte (default soccer), evitando sportKey is not defined.

✅ Logs opcionales de cercanía a kickoff: LOG_VERBOSE=1 habilita vista previa de partidos próximos (minutos a inicio).

✅ Mensajería (canal & VIP) intacta: liga con país, “Comienza en X minutos aprox”, Top-3 bookies (mejor en negritas) y frase final aprobada.

🔄 Diagnóstico V2 (UI HTML) en progreso.

🔄 Memoria IA → prompt (Supabase) activa y por compactar/optimizar.

🔄 Outrights alineados conceptualmente; se afinan coherencias/umbral.

3) Arquitectura (alto nivel)

Netlify Functions (serverless)

netlify/functions/autopick-vip-nuevo.cjs → orquestador pre-match (cada 15 min).

netlify/functions/autopick-outrights.cjs → outrights con reglas espejo de pre-match.

netlify/functions/autopick-live.cjs → live preparado (pausado).

netlify/functions/send.js → formatos Telegram (canal & VIP).

netlify/functions/diagnostico-total.js + _diag-core-v4.cjs → panel/estado.

Utilidades: _corazonada.cjs, _telemetry.cjs, _supabase-client.cjs, prompts_punterx.md, telegram_formatos.md.

Config: netlify.toml, package.json.

Fuentes

OddsAPI → cuotas/mercados reales (h2h, totales, spreads).

API-FOOTBALL PRO → fixtures, alineaciones, árbitro, clima, forma, xG, lesiones, historial.

OpenAI (GPT-5) → análisis y JSON único por evento (1 llamada con fallback).

Persistencia (Supabase)

picks_historicos, odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones (+ tablas de memoria IA).

4) Flujo maestro (pre-match, 45–55 min)

OddsAPI: obtener eventos con cuotas (regiones parametrizadas).

Filtro temporal: ventana 45–55 (fallback 35–70 si procede).

Resolver AF (match 100% general): país/liga/equipos/fecha. Con STRICT_MATCH=1: si no cuadra fixture AF → descartar.

Prompt IA: sólo opciones apostables reales (de OddsAPI) + contexto AF (alineaciones, lesiones, clima, árbitro, forma, xG, historial) + memoria IA compacta.

OpenAI: 1 llamada (con fallback) → JSON con apuesta, probabilidad, analisis_free, analisis_vip, apuestas_extra, no_pick, frases, etc.

Validaciones (ver §10): rango prob., coherencia con implícita, EV mínimo, outcome válido, Top-3 coherente.

Clasificación por EV → FREE (10–14.9%) / VIP (≥15%) por niveles.

Mensajería Telegram (branding aprobado).

Guardar en Supabase (+ snapshots de cuotas, memoria IA).

Telemetría (locks, contadores, causas de descarte).

5) Ventanas y tiempos

Principal: 45–55 min antes del kickoff.

Fallback: 35–70 min (sin romper STRICT_MATCH).

Cron maestro: cada 15 min (Netlify).

Zona horaria: America/Mexico_City (ENV TZ).

Nota: Si tu log imprime “40–55”, ajusta WINDOW_MAIN_MIN=45 para alinearlo al estándar.

6) IA y guardrails

1 llamada por partido (con reintento corto).

no_pick=true → corta.

Prob. IA: 5%–85%.

Coherencia |P(IA) − P(implícita)| ≤ 15 p.p.

Apuesta válida: debe existir en outcomes del evento; seleccionar cuota exacta.

Top-3 bookies: orden por cuota; mejor en negritas (VIP).

Corazonada IA: señal cualitativa configurable (ver §13).

7) Cálculo EV y niveles

EV = función de P(IA) vs P(implícita) (cuota elegida).

Umbrales:

VIP: EV ≥ 15%

🟣 Ultra Élite: ≥ 40%

🎯 Élite Mundial: 30–39.9%

🥈 Avanzado: 20–29.9%

🥉 Competitivo: 15–19.9%

FREE (📄 Informativo): 10–14.9%

No guardar EV < 10% ni picks incompletos.

8) Formatos de mensaje (Telegram)

Canal gratuito (@punterxpicks)

Encabezado: 📡 RADAR DE VALOR

Contiene: liga (con país), equipos, hora “Comienza en X minutos aprox”, análisis breve IA, frase motivacional, CTA al VIP, disclaimer.

Sin apuesta sugerida.

Grupo VIP (-1002861902996)

Encabezado: 🎯 PICK NIVEL: [Ultra/Élite/Avanzado/Competitivo]

Contiene: liga (con país), equipos, hora de inicio, EV y prob.; Apuesta sugerida + Apuestas extra (O2.5, BTTS, Doble oportunidad, Goleador, Marcador exacto, HT result, Hándicap asiático); Top-3 bookies (mejor en negritas); Datos avanzados (clima/árbitro/lesiones/historial/xG); Corazonada IA si aplica; disclaimer.

Frase final (todas las piezas):
“🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.”

9) Variables de entorno (Netlify)

Ya configuradas:
API_FOOTBALL_KEY, AUTH_CODE, AWS_LAMBDA_JS_RUNTIME, CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG, ENABLE_OUTRIGHTS, ENABLE_OUTRIGHTS_INFO, LIVE_COOLDOWN_MIN, LIVE_MARKETS, LIVE_MIN_BOOKIES, LIVE_POLL_MS, LIVE_PREFILTER_GAP_PP, LIVE_REGIONS, MATCH_RESOLVE_CONFIDENCE, MAX_OAI_CALLS_PER_CYCLE, NODE_OPTIONS, NODE_VERSION, ODDS_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK, OUTRIGHTS_COHERENCE_MAX_PP, OUTRIGHTS_EV_MIN_VIP, OUTRIGHTS_EXCLUDE, OUTRIGHTS_MIN_BOOKIES, OUTRIGHTS_MIN_OUTCOMES, OUTRIGHTS_PROB_MAX, OUTRIGHTS_PROB_MIN, PANEL_ENDPOINT, PUNTERX_SECRET, RUN_WINDOW_MS, SUB_MAIN_MAX, SUB_MAIN_MIN, SUPABASE_KEY, SUPABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID, TZ, WINDOW_FALLBACK_MAX, WINDOW_FALLBACK_MIN, WINDOW_FB_MAX, WINDOW_FB_MIN, WINDOW_MAIN_MAX, WINDOW_MAIN_MIN, WINDOW_MAX, WINDOW_MIN.

Nuevas / confirmadas hoy (corrección de rumbo):

ODDS_REGIONS=us,uk,eu,au ← nuevo (default global)

STRICT_MATCH=1 ← nuevo (mismatch AF → descarta)

ODDS_SPORT_KEY=soccer ← nuevo (control deporte; evita sportKey indefinido)

LOG_VERBOSE=0|1 ← nuevo (logs de cercanía a kickoff)

Herencias y prioridades:
LIVE_REGIONS no se redeclara; si falta ODDS_REGIONS, Live hereda de allí.
ODDS_SPORT_KEY default soccer — se puede cambiar centralmente si ampliamos deportes.

10) Reglas de validación y guardado

no_pick === true → descartar.

Integridad: apuesta, probabilidad, analisis_free, analisis_vip.

Outcome válido y cuota exacta (OddsAPI) para ese mercado.

Prob. IA en [5%, 85%].

Coherencia ≤ 15 p.p. vs implícita de la cuota.

EV ≥ 10% para guardar; VIP sólo si EV ≥ 15%.

Anti-duplicado por evento (pre-match) y por torneo (outrights).

Top-3 bookies adjunto si existe top3_json.

Mensajes según formatos (liga con país, hora texto, frase final).

11) Anti-duplicado y locks

Anti-duplicado en picks_historicos por evento (pre-match) / torneo (outrights).

Lock distribuido en px_locks con TTL para evitar dobles envíos por solapamiento de invocaciones.

12) Supabase — esquema recomendado

picks_historicos (core memoria/auditoría)

evento (text)

analisis (text) ← puede concatenar FREE/VIP si no hay campos separados

apuesta (text)

tipo_pick (text: 'VIP' | 'FREE')

liga (text)

equipos (text)

ev (numeric)

probabilidad (numeric)

nivel (text: 🟣/🎯/🥈/🥉/📄)

timestamp (timestamptz)

top3_json (jsonb) (recomendado)

-- Idempotente (por si faltara top3_json)
alter table if exists public.picks_historicos
  add column if not exists top3_json jsonb;


Otras tablas: odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones (+ tablas de memoria IA).

13) Corazonada IA (señal cualitativa)

Flags/pesos:
CORAZONADA_ENABLED (0/1),
CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG.

Inputs: disponibilidad AF (alineaciones/lesiones), contexto (forma/historial), señales de mercado (cambios en mejores cuotas / odds_snapshots), métricas xG.

Salida: texto breve (+ score interno opcional). Se muestra en VIP si está activo.

14) Outrights (misma filosofía)

Sin listas fijas; resolver AF por búsqueda textual/season vigente.

Validaciones espejo: outcome real, prob. IA 5–85%, coherencia ≤ 15 p.p., EV ≥ OUTRIGHTS_EV_MIN_VIP para VIP.

Anti-duplicado por torneo; Top-3 si aplica.

15) Live (preparado, en pausa)

Motivo: consumo alto de llamadas a OddsAPI en Replit (costos).

Estado del código: coherente (una sola LIVE_REGIONS, URLs con ${encodeURIComponent(LIVE_REGIONS)}).

Re-activación planificada: subir plan de OddsAPI + (opcional) ENABLE_LIVE, LIVE_POLL_MS, LIVE_COOLDOWN_MIN, LIVE_MIN_BOOKIES, LIVE_PREFILTER_GAP_PP, LIVE_MARKETS.

16) Diagnóstico y observabilidad

Diagnóstico V2 (HTML): estado de APIs, locks, picks recientes, causas de descarte (coherencia, rango prob., sin outcome, no_pick, etc.), consumo básico y señales de mercado.

Telemetría de ciclo: totales por etapa (consultas, candidatos, IA OK/fallback, FREE/VIP, descartes y causa, guardados, enviados).

17) Seguridad, estilo y despliegue

CommonJS (.cjs) siempre; sin ESM ni top-level await.

Claves reales sólo por ENV (Netlify).

Cero hardcodes de ligas/IDs/regiones.

Backups antes de cambios amplios; diffs mínimos para correcciones puntuales.

Docs sincronizadas: cualquier cambio en lógica/vars debe reflejarse aquí y en punterx.md.

18) Cambios aplicados hoy (2025-08-17)

Eliminados hardcodes de ligas/IDs (e.g., AF_LEAGUE_ID_BY_TITLE).

Parametrizadas regiones vía ODDS_REGIONS (default global) con fallback a LIVE_REGIONS.

STRICT_MATCH=1 reforzado (mismatch AF → no IA, no EV, no envío).

Fix LIVE_REGIONS duplicado y reemplazo de literales regions=uk.

Fix URLs OddsAPI: concatenación clásica / URL nativa (evita errores por backticks).

Nuevas ENV: ODDS_SPORT_KEY, LOG_VERBOSE.

Snippet de vista previa de próximos partidos (activable con LOG_VERBOSE=1).

Mensajería verificada: liga+país, “Comienza en X minutos aprox”, Top-3, frase final.

19) Roadmap inmediato (qué sigue)

Diagnóstico V2 (UI HTML) completo (errores, causas, consumo, señales).

Memoria IA: relevancia por equipo/liga/mercado, resumen compacto al prompt, registro ex-post.

Outrights: afinar coherencia y umbral, anti-duplicado por torneo consolidado.

Costos: límites a OpenAI por ciclo (MAX_OAI_CALLS_PER_CYCLE), backoff si OddsAPI/AF fallan.

Live (cuando suba el plan): ENABLE_LIVE, rate-limit con LIVE_POLL_MS/LIVE_COOLDOWN_MIN.

20) Checklist de despliegue (cada cambio)

 ODDS_REGIONS, STRICT_MATCH, ODDS_SPORT_KEY, LOG_VERBOSE en Netlify (sin claves en repo).

 Sin regions= literales; usar ${encodeURIComponent(...REGIONS)}.

 STRICT_MATCH corta antes de IA/EV/enviar.

 Mensajería mantiene formato y branding.

 Supabase listo (incluye top3_json).

 Logs/diagnóstico limpios (sin data.find is not a function, etc.).

21) secrets.env.example (plantilla — no poner valores reales)
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

# Tiempo/ventanas
TZ=America/Mexico_City
WINDOW_MAIN_MIN=45
WINDOW_MAIN_MAX=55
WINDOW_FALLBACK_MIN=35
WINDOW_FALLBACK_MAX=70

# OddsAPI – regiones y deporte
ODDS_REGIONS=us,uk,eu,au
LIVE_REGIONS=us,uk,eu,au
ODDS_SPORT_KEY=soccer

# Matching estricto
STRICT_MATCH=1

# IA
MAX_OAI_CALLS_PER_CYCLE=20

# Logs
LOG_VERBOSE=0

# Corazonada
CORAZONADA_ENABLED=1
CORAZONADA_W_AVAIL=0.25
CORAZONADA_W_CTX=0.25
CORAZONADA_W_MARKET=0.25
CORAZONADA_W_XG=0.25

22) Errores frecuentes y soluciones

“Identifier 'LIVE_REGIONS' has already been declared” → Deja una declaración y elimina reasignaciones.

“Unexpected identifier '$'” en URLs → Evita backticks; usa concatenación o new URL(...).

data.find is not a function → Normaliza: const arr = Array.isArray(data) ? data : [];.

Outcome no válido / sin cuota exacta → Verifica mapping de mercados y existencia de la cuota elegida; si no, descarta.

Coherencia > 15 p.p. → Descarta; revisa que la cuota corresponda al mercado exacto.

Duplicados → Anti-duplicado por evento (pre-match) y torneo (outrights).

Fin de PunterX-Config.md.
