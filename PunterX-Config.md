PunterX-Config.md

Versión: 2025-08-18
Responsables: Luis Sánchez (owner) · Dev Senior PunterX
Ámbito: Fútbol (soccer) global — pre‑match y outrights. Live preparado pero en pausa por costos.

1) Propósito y principio rector

Objetivo: detectar y publicar picks de alto EV en todos los partidos apostables (sin whitelists), con enriquecimiento de API‑FOOTBALL PRO, validaciones estrictas y guardrails de IA.
Principios clave:

Cobertura 100% general: sin ligas/IDs ni regiones hardcodeadas.

Ventana principal: 45–55 min antes del kickoff (fallback 35–70 si aplica).

STRICT_MATCH=1: si OddsAPI y API‑FOOTBALL no cuadran, no se publica.

2) Estado actual del repo (este .zip)

⚠️ Pendiente de aplicar varias mejoras acordadas (ver §17 “Acciones pendientes con anclas exactas”):

Parametrización de regiones y sport key en OddsAPI (se ven hardcodes y ... en URLs).

Logger central y logs enriquecidos (no están integrados).

Arreglo de Telegram (FREE/VIP) con fetchWithRetry (bloque roto).

Limpieza de ... en netlify.toml y workflows YAML.

Unificación de parse_mode en HTML.

✅ Mantiene lógica base (ventanas / IA / guardrails / STRICT_MATCH ya descarta).

✅ Diagnóstico total (HTML + JSON) existente — UI propia en diagnostico-total.js.

✅ Webhook VIP de prueba de 15 días funcionando en producción (tg_trial_webhook.cjs, ver §9, §21).

Este documento incluye anclas exactas para aplicar los cambios cuando indiques, y documenta todo lo nuevo (trial VIP, gestión de usuarios, seguridad, env vars, crons).

3) Arquitectura

Netlify Functions (CommonJS, Node 18/20)

autopick-vip-nuevo.cjs → pre‑match orquestador.

autopick-outrights.cjs → outrights (reglas espejo de pre‑match).

autopick-live.cjs → live (pausado).

_lib/af-resolver.cjs, _lib/match-helper.cjs, _lib/match-normalizer.cjs → matching AF/OddsAPI.

_supabase-client.cjs, _telemetry.cjs, _corazonada.cjs.

send.js → Telegram (canal/VIP).

diagnostico-total.js → panel y JSON.

Nuevo: tg_trial_webhook.cjs → webhook Telegram para trial VIP 15 días (self‑contained).

Nuevo recomendado: check-expirados.cjs y notify-expiry.cjs (crons de expiración/avisos).

Fuentes

OddsAPI /v4/sports/:sport/odds (mercados: h2h,totals,spreads; odds decimal).

API‑FOOTBALL PRO v3: fixtures, alineaciones, árbitro, clima, forma, xG, lesiones, historial.

OpenAI GPT‑5 → 1 JSON por evento (1 llamada con fallback corto).

Supabase

picks_historicos, odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones (+memoria IA).

Nuevo (usuarios VIP): tabla usuarios (ver §12, §20.2).

4) Flujo maestro (pre‑match)

OddsAPI: obtener eventos con cuotas (regiones por ENV).

Ventanas: principal 45–55; fallback 35–70 (sin saltar STRICT_MATCH).

Matching AF (general): país/liga/equipos/fecha → si no cuadra y STRICT_MATCH=1 → descartar.

Prompt IA: sólo opciones reales de OddsAPI + contexto AF (alineaciones, lesiones, clima, árbitro, forma, xG, historial) + memoria IA compacta.

OpenAI: 1 llamada (fallback) → JSON: apuesta, probabilidad, analisis_free, analisis_vip, apuestas_extra, no_pick, frases, etc.

Validaciones (ver §10): rango prob., coherencia con implícita, EV mínimo, outcome válido, Top‑3 coherente.

Clasificación por EV → FREE (10–14.9) / VIP (≥15) por niveles.

Telegram (formatos aprobados).

Supabase (guardar + snapshots odds + memoria IA).

Telemetría (locks, contadores, causas).

5) Ventanas y tiempos

Principal: 45–55 min.

Fallback: 35–70 min.

Cron: cada 15 min (Netlify).

TZ: America/Mexico_City.

6) IA y guardrails

1 llamada por partido (con reintento corto).

no_pick=true → corta.

Prob. IA en [5%, 85%].

Coherencia |P(IA) − P(implícita)| ≤ 15 p.p.

Apuesta válida: debe existir outcome real y cuota exacta.

Top‑3 bookies: orden correcto; mejor en negritas (VIP).

Corazonada IA: señal cualitativa (pesos por disponibilidad/contexto/mercado/xG) — incluida en VIP y en apuestas futuras (si procede).

7) EV y niveles

VIP: EV ≥ 15

🟣 Ultra Élite ≥ 40

🎯 Élite Mundial 30–39.9

🥈 Avanzado 20–29.9

🥉 Competitivo 15–19.9

FREE: 10–14.9 (informativo).

No guardar EV < 10 ni picks incompletos.

8) Formatos Telegram

Canal (@punterxpicks)

📡 RADAR DE VALOR · liga (con país), “Comienza en X minutos aprox”, análisis breve, frase motivacional, CTA VIP, disclaimer. (Sin banderas de países, a petición.)

VIP (ID numérico del supergrupo)

🎯 PICK NIVEL [Ultra/Élite/Avanzado/Competitivo] · liga (con país), hora, EV y prob., apuesta sugerida + apuestas extra (O2.5, BTTS, Doble Oportunidad, Goleador, Marcador exacto, HT result, Hándicap asiático), Top‑3 (mejor en negritas), datos avanzados (clima/árbitro/lesiones/historial/xG), corazonada IA, disclaimer.

Frase final: “🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.”

Seguridad de contenido

Grupo VIP con Restrict Saving Content activado (ajuste de Telegram).

Todos los envíos del bot con protect_content: true (ver §17.4 “send.js”).

9) Variables de entorno (Netlify)

Presentes (según panel):
API_FOOTBALL_KEY, AUTH_CODE, AWS_LAMBDA_JS_RUNTIME, CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG, ENABLE_OUTRIGHTS, ENABLE_OUTRIGHTS_INFO, LIVE_COOLDOWN_MIN, LIVE_MARKETS, LIVE_MIN_BOOKIES, LIVE_POLL_MS, LIVE_PREFILTER_GAP_PP, LIVE_REGIONS, MATCH_RESOLVE_CONFIDENCE, MAX_OAI_CALLS_PER_CYCLE, NODE_OPTIONS, NODE_VERSION, ODDS_API_KEY, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MODEL_FALLBACK, OUTRIGHTS_COHERENCE_MAX_PP, OUTRIGHTS_EV_MIN_VIP, OUTRIGHTS_EXCLUDE, OUTRIGHTS_MIN_BOOKIES, OUTRIGHTS_MIN_OUTCOMES, OUTRIGHTS_PROB_MAX, OUTRIGHTS_PROB_MIN, PANEL_ENDPOINT, PUNTERX_SECRET, RUN_WINDOW_MS, STRICT_MATCH, SUB_MAIN_MAX, SUB_MAIN_MIN, SUPABASE_KEY, SUPABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, TELEGRAM_GROUP_ID, TELEGRAM_VIP_GROUP_ID, TRIAL_DAYS, TRIAL_INVITE_TTL_SECONDS, TZ, WINDOW_FALLBACK_MAX, WINDOW_FALLBACK_MIN, WINDOW_FB_MAX, WINDOW_FB_MIN, WINDOW_MAIN_MAX, WINDOW_MAIN_MIN, WINDOW_MAX, WINDOW_MIN.

Recomendadas (para normalizar):

ODDS_REGIONS=us,uk,eu,au ← cobertura global (evita hardcodes).

ODDS_SPORT_KEY=soccer ← /v4/sports/:sport/odds.

LOG_VERBOSE=1|0, LOG_EVENTS_LIMIT=8 ← logging enriquecido.

AWS_LAMBDA_JS_RUNTIME=nodejs18.x (si necesitas forzar runtime con fetch global).

10) Reglas de validación y guardado

no_pick → descartar.

Integridad: apuesta, probabilidad, analisis_free, analisis_vip.

Outcome válido + cuota exacta (OddsAPI).

Prob. IA [5, 85].

Coherencia ≤ 15 p.p.

EV ≥ 10 para guardar; VIP si EV ≥ 15.

Anti‑duplicado por evento (pre‑match) / torneo (outrights).

Top‑3 bookies adjunto (top3_json).

Corazonada IA presente si CORAZONADA_ENABLED=1.

11) Anti‑duplicado y locks

Duplicado por evento (pre‑match) y por torneo (outrights).

Lock distribuido px_locks con TTL para evitar envíos simultáneos.

12) Supabase (esquemas)
12.1 picks_historicos

evento (text), analisis (text), apuesta (text), tipo_pick ('VIP'/'FREE'), liga (text), equipos (text), ev (numeric), probabilidad (numeric), nivel (text), timestamp (timestamptz), top3_json (jsonb).

alter table if exists public.picks_historicos
  add column if not exists top3_json jsonb;


Otros: odds_snapshots, px_locks, diagnostico_estado, diagnostico_ejecuciones, tablas de memoria IA.

12.2 Usuarios VIP (usuarios) — Nuevo

Campos mínimos:

id_telegram (bigint/text, PK lógica)

username (text, opcional)

email (text, opcional — ver §21 Onboarding por email)

estado (trial | premium | expired)

fecha_inicio (timestamptz)

fecha_expira (timestamptz)

trial_used (boolean, default false)

onboarding_state (text, null | 'awaiting_email')

Sugerencias:

create table if not exists public.usuarios (
  id_telegram text primary key,
  username text,
  email text,
  estado text check (estado in ('trial','premium','expired')),
  fecha_inicio timestamptz,
  fecha_expira timestamptz,
  trial_used boolean not null default false,
  onboarding_state text
);

create index if not exists usuarios_email_idx
  on public.usuarios (email) where trial_used = true;

13) Corazonada IA

Flags/pesos: CORAZONADA_ENABLED, CORAZONADA_W_AVAIL, CORAZONADA_W_CTX, CORAZONADA_W_MARKET, CORAZONADA_W_XG.
Inputs: alineaciones/lesiones, forma/historial, señales de mercado (snapshots), xG.
Salida: texto breve (+ score interno opcional). Debe aparecer en VIP y puede aparecer en “apuestas futuras” si aplica.

14) Outrights

Sin listas fijas; resolver AF por texto/season.
Validaciones espejo: outcome real, prob. IA [5–85], coherencia ≤ 15 p.p., EV ≥ OUTRIGHTS_EV_MIN_VIP para VIP.
Anti‑duplicado por torneo; Top‑3 si aplica.

15) Live (pausado)

Motivo: consumo alto de llamadas a OddsAPI desde Replit.
Estado: código funcional, pero regiones hardcodeadas (ver §17.2).
Reactivación futura: subir plan + rate‑limit.

16) Diagnóstico y observabilidad

diagnostico-total.js → UI HTML (Tailwind/Chart.js) + salida JSON si ?json=1|true.
Métricas clave: consultas, candidatos, IA OK/fallback, FREE/VIP, causas de descarte, guardados, enviados, duración de ciclo, estado APIs, locks.

17) Acciones pendientes (con anclas exactas para aplicar)
17.1 autopick-vip-nuevo.cjs

Telegram (FREE/VIP) roto — Reemplazar bloques de envío por fetchWithRetry:

const res = await fetchWithRetry(
  url,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  { retries: 2, base: 600 }
);


OddsAPI URL — reemplazar hardcodes por ENV:

const SPORT = process.env.ODDS_SPORT_KEY || 'soccer';
const REGIONS = process.env.ODDS_REGIONS || process.env.LIVE_REGIONS || 'us,uk,eu,au';
const base = 'https://api.the-odds-api.com/v4/sports/' + encodeURIComponent(SPORT) + '/odds';
const url =
  base +
  '?apiKey=' + encodeURIComponent(ODDS_API_KEY) +
  '&regions=' + encodeURIComponent(REGIONS) +
  '&oddsFormat=decimal' +
  '&markets=h2h,totals,spreads';


Logs enriquecidos — importar y crear logger; contadores de causas; “Próximos eventos (mins)”. (Ver bloque completo del plan original; mantener causas.* y resumen final.)

17.2 autopick-live.cjs

Reemplazar:

LIVE_REGIONS = "uk",


por:

const LIVE_REGIONS = process.env.LIVE_REGIONS || process.env.ODDS_REGIONS || 'us,uk,eu,au';


y usar en cada URL:

'&regions=' + encodeURIComponent(LIVE_REGIONS)

17.3 autopick-outrights.cjs

Reemplazar:

const REGIONS = "eu,uk,us";
...
&regions=${encodeURIComponent(REGIONS)}


por:

const REGIONS = process.env.ODDS_REGIONS || 'us,uk,eu,au';
...
&regions=${encodeURIComponent(REGIONS)}

17.4 send.js

Unificar HTML y proteger contenido:

parse_mode: "HTML",
protect_content: true

17.5 netlify.toml

Eliminar línea(s) con ... bajo [functions].

17.6 Workflows (.github/workflows/*.yml)

Eliminar todas las líneas ... (rompen YAML).

18) Roadmap inmediato

Aplicar sustituciones de §17 (copy/paste con anclas).

Re‑deploy en Netlify → verificar logs enriquecidos y diagnóstico.

Activar logs extra: LOG_VERBOSE=1, LOG_EVENTS_LIMIT=8.

Unificar parse_mode a HTML en todos los flujos y protect_content: true.

Cuando haya presupuesto: reactivar Live con RATE‑LIMIT.

19) secrets.env.example (plantilla)
ODDS_API_KEY=
API_FOOTBALL_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
OPENAI_MODEL_FALLBACK=gpt-4o-mini

SUPABASE_URL=
SUPABASE_KEY=
# Recomendado en server: SUPABASE_SERVICE_ROLE_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
TELEGRAM_GROUP_ID=
TELEGRAM_VIP_GROUP_ID=

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

# VIP Trial
TRIAL_DAYS=15
TRIAL_INVITE_TTL_SECONDS=86400

# (Opcional) Runtime explícito
AWS_LAMBDA_JS_RUNTIME=nodejs18.x

20) Errores comunes y estado/soluciones

Telegram FREE/VIP roto → Pendiente de fix en autopick-vip-nuevo.cjs (fetchWithRetry + parse_mode: 'HTML' + protect_content: true).

Webhook Telegram “reading from” → Solucionado:

Nuevo handler self‑contained tg_trial_webhook.cjs que usa message.chat.id (no accede a .from).

Inicialización ESM de Supabase v2 vía import('@supabase/supabase-js') + createClient(...).

Re‑deploy para que las ENV vivan en runtime de Functions.

OddsAPI URL con ... y regiones fijas → Pendiente aplicar §17.1.

LIVE_REGIONS hardcode → Pendiente (ver §17.2).

Outrights REGIONS hardcode → Pendiente (ver §17.3).

parse_mode Markdown → Pendiente unificar en HTML + protect_content.

netlify.toml con ... → Pendiente (ver §17.5).

Workflows con ... → Pendiente (ver §17.6).

STRICT_MATCH → Activo (descarta si AF no cuadra).

21) Gestión de usuarios VIP (Trial 15 días → Premium)
21.1 Webhook de trial (ya en producción)

Archivo: netlify/functions/tg_trial_webhook.cjs
Características clave:

Filtra solo update.message privado con texto.

Usa message.chat.id (no accede a .from).

Crea cliente Supabase con ESM dinámico (import('@supabase/supabase-js')).

Comandos soportados:

/vip → activa prueba 15 días (si no la usó antes) y envía invite de 1 uso al grupo VIP.

/status → estado actual (trial con días restantes, premium, expired).

/ayuda → ayuda y comandos.

Invites con:

member_limit: 1 (1 uso).

Opcional: caducidad 24 h si TRIAL_INVITE_TTL_SECONDS > 0.

Envía con parse_mode: 'HTML' y protect_content: true.

Webhook (set):

POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
{
  "url": "https://<site>.netlify.app/.netlify/functions/tg_trial_webhook",
  "allowed_updates": ["message"],
  "drop_pending_updates": true
}


Requisitos:

Bot admin del supergrupo VIP con permiso invitar usuarios.

ENV: TELEGRAM_BOT_TOKEN, TELEGRAM_VIP_GROUP_ID, SUPABASE_URL, SUPABASE_KEY (o SERVICE_ROLE_KEY), TRIAL_DAYS, TRIAL_INVITE_TTL_SECONDS (opcional).

21.2 Notificaciones de vencimiento (cron)

Objetivo: mejorar conversión y UX.

D‑2: “Tu prueba termina en 2 días…”

D‑0: “Tu prueba termina hoy…”

Función sugerida: netlify/functions/notify-expiry.cjs (cron diario, por ej. 0 14 * * * UTC≈mañana local).
Lógica:

Seleccionar usuarios con estado='trial' y fecha_expira en now()+2d → enviar aviso D‑2.

Seleccionar usuarios con estado='trial' y fecha_expira en hoy → enviar aviso D‑0.

En ambos, CTA a pago (o a contacto/soporte mientras se integra pasarela).

21.3 Expiración automática (cron)

Archivo existente recomendado: netlify/functions/check-expirados.cjs (cron diario).

Marca estado='expired' donde fecha_expira <= now() y estado='trial'.

Opcional: si guardas invite_link o tienes al usuario en el grupo, banChatMember para expulsarlo (bot admin).

Mantener registro en Supabase.

21.4 Seguridad y anti‑abuso

Grupo VIP con Restrict Saving Content (propiedad del grupo).

Bot: protect_content: true en cada mensaje.

Invitaciones: 1 uso + TTL (24 h) opcional.

Reenvíos sólo se pueden detectar si el bot está en el chat destino (limitación Telegram).

T&C fijados en FREE y VIP (ver §22), aviso de uso personal y consecuencias (advertencia / expulsión).

21.5 Onboarding por e‑mail (opcional, recomendado)

Meta: una prueba por persona (no por cada cuenta de Telegram).

Flujo Telegram‑only:

Guardar onboarding_state='awaiting_email' al pedir correo.

Validar formato y unicidad: si email ya tiene trial_used=true → denegar nueva prueba.

Activar trial y marcar trial_used=true.

Alternativa “web‑light”: endpoint HTML en Netlify con firma HMAC y formulario de e‑mail.

(Campos ya documentados en §12.2.)

22) Contenido fijo (canal FREE y grupo VIP)

FREE (fijado):

CTA directo: t.me/<TuBot>?start=vip15

Resumen de beneficios VIP (EV≥15% clasificado, datos avanzados, apuestas extra, registro automático).

Aviso: prueba 15 días, luego Premium.

VIP (fijado):

Términos y condiciones (T&C) esenciales:

Uso personal; 1 cuenta por persona.

Prohibido reenvío/copia/publicación de picks.

El contenido está protegido contra reenvío (Restrict Saving Content + protect_content).

Incumplimientos → advertencia o expulsión.

Fechas y condiciones de la prueba/renovación.

23) Apuestas futuras (recordatorio)

Ventana, validaciones y formatos iguales que pre‑match; con corazonada IA incluida.

Sin banderas.

Registrar en Supabase con el mismo esquema de picks y memoria IA.

Envío a FREE/VIP con estilo Resumen → Acción → Detalle.

24) Estilo y seguridad

Idioma: español.

Formato: Resumen → Acción → Detalle.

Cambios pequeños de código: indicar líneas y diff mínimo.

Mantener CommonJS (.cjs), evitar ESM puro y top‑level await.

Nunca exponer claves reales → usar process.env.* y secrets.env.example.

Antes de producción: advertir riesgos y proponer backup.

25) Archivos clave

autopick-vip-nuevo.cjs

autopick-outrights.cjs

autopick-live.cjs (pausado)

send.js

diagnostico-total.js

netlify.toml

package.json

prompts_punterx.md

secrets.env.example

telegram_formatos.md

picks_historicos_schema.sql

Nuevo: tg_trial_webhook.cjs, check-expirados.cjs, notify-expiry.cjs (sugerido)

26) Nota de sincronización

Cada cambio en código, variables o lógica debe reflejarse aquí y en PunterX‑Config.md (este documento). Mantener sincronizado con prompts_punterx.md y telegram_formatos.md.

27) Historial de incidentes recientes (Telegram VIP)

Agosto 18, 2025 — Error Cannot read properties of undefined (reading 'from') en webhook previo.
Causa: bundle con handler legado accediendo update.message.from.
Solución: función nueva tg_trial_webhook.cjs que usa message.chat.id; aislamiento de dependencias (no send.js), fetch nativo, Supabase v2 vía import(); re‑deploy; setWebhook a la ruta nueva; allowed_updates=["message"], drop_pending_updates=true.
Estado: Resuelto (en logs: “trial granted and link sent”).

Fin del documento.
