📄 PunterX — Configuración y Estado Actual

Fecha: 15 de agosto de 2025

0) Resumen ejecutivo

PunterX es un sistema automatizado para detectar y publicar picks de alto EV vía OddsAPI (cuotas), API-FOOTBALL PRO (datos deportivos), OpenAI GPT-5 (análisis y diagnóstico), Supabase (histórico y memoria IA) y Telegram (canal FREE y grupo VIP).
Ahora incorpora apuestas EN VIVO (in-play) con flujo de prefiltro de valor, enriquecimiento de partido en tiempo real y mensajes editables/fijados en VIP.

1) Arquitectura (alta nivel)

Runtime: Netlify Functions (Node 20, CommonJS con esbuild).

Datos externos:

OddsAPI — cuotas (pre y live), mercados, consenso/top-3.

API-FOOTBALL PRO — fixtures, minuto/estado, marcador, árbitro, clima, odds live de respaldo.

IA: OpenAI GPT-5 / GPT-5-mini (fallback) → JSON estructurado para análisis.

Persistencia: Supabase (picks_historicos + telemetría opcional).

Distribución: Telegram Bot API (FREE channel y VIP group).

Operación: crons Netlify; opción Replit para “loop” local.

Compatibilidad y coherencia: mantener CommonJS, sin top-level await. Mantener formato de mensajes y reglas de EV.

2) Archivos clave

netlify/functions/autopick-vip-nuevo.cjs — Pre-match (ventana principal 40–55 min; fallback 35–70).

NUEVO: mapeo AF_LEAGUE_ID_BY_TITLE y enriquecimiento por league_id + date (reduce “Sin coincidencias”).

netlify/functions/autopick-outrights.cjs — Apuestas a futuro (teaser 7d antes, final 24±2h).

NUEVO: AF_LEAGUE_ID_BY_SPORTKEY y resolución de liga por /leagues?id= (fallback search=).

netlify/functions/autopick-live.cjs — En vivo (in-play).

OddsAPI-first para prefiltro (qué es apostable + mejores precios), AF para minuto/marcador/fase, IA si hay valor, EV+validaciones, envío Telegram (VIP fijado), guardado Supabase, anti-duplicado por bucket 5’.

netlify/functions/send.js — helpers FREE/VIP (Pre, Live, Outrights) + endpoint /send.

NUEVO: plantillas LIVE y PRE/OUTRIGHT, top-3 sin numeración y #1 en negritas; país antes de la liga; edición y pin.

prompts_punterx.md — prompts IA consolidados.

PunterX-Config.md — este documento.

Otros: diagnostico-total.js, verificador-aciertos.js, analisis-semanal.js, memoria-inteligente.js, check-status.js.

3) Formatos de mensaje (consolidado)
3.1 Pre-match — FREE
📡 RADAR DE VALOR
🏆 {pais} - {liga} - {equipos}
🕒 Inicio: {kickoff}

📊 Análisis:
{analisis}

🎁 Únete al VIP para ver:
- EV y probabilidad estimada
- Apuesta sugerida + Apuestas extra
- Top-3 casas con mejor cuota

🔎 IA Avanzada, monitoreando el mercado global 24/7.
⚠️ Este contenido es informativo. Apostar conlleva riesgo.

3.2 Pre-match — VIP
🎯 PICK {nivel}
🏆 {pais} - {liga} - {equipos}
🕒 Inicio: {kickoff}

EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}

💡 Apuesta sugerida: {apuesta_sugerida}

Apuestas extra:
{apuestas_extra}

🏆 Top-3 casas (mejor resaltada):
{top3}

📊 Datos avanzados:
{datos}

🔎 IA Avanzada, monitoreando el mercado global 24/7.
⚠️ Este contenido es informativo. Apostar conlleva riesgo.

3.3 En vivo — FREE
🔴 EN VIVO - RADAR DE VALOR
🏆 {pais} - {liga} - {equipos}
⏱️ {minuto}  |  Marcador: {marcador}  |  Fase: {fase}

📊 Análisis en tiempo real:
{razonamiento}

💬 “En vivo, cada jugada puede cambiarlo todo. Aquí es donde nacen las oportunidades.”

🎁 Únete al VIP para ver:
- Apuesta sugerida y apuestas extra
- EV y probabilidad estimada
- Top-3 casas con la mejor cuota

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
⚠️ Este contenido es informativo. Apostar conlleva riesgo.

3.4 En vivo — VIP
🔴 LIVE PICK - {nivel}
🏆 {pais} - {liga} - {equipos}
⏱️ {minuto}  |  Marcador: {marcador}  |  Fase: {fase}

EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}

💡 Apuesta sugerida: {apuesta_sugerida}
📌 Vigencia: {vigencia}

Apuestas extra:
{apuestas_extra}

📊 Razonamiento EN VIVO:
{razonamiento}

🏆 Top-3 casas (mejor resaltada):
{top3}

🧭 Snapshot mercado:
{snapshot}

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
⚠️ Este contenido es informativo. Apostar conlleva riesgo.


Detalles de formato globales:

País antes de la liga.

Top-3 sin numeración, mejor en negritas.

Eliminada la frase de “última actualización”.

En VIP LIVE el post se puede fijar y editar (minuto/cuotas/EV/notas).

3.5 Outrights (teaser y final)

Teaser (~7 días antes) → FREE + VIP.

Final (24 ± 2h) → VIP (EV ≥ 15%) o FREE (10–14.9%).

Apuestas extra por probabilidad (umbral configurable).

Top-3 casas y “Datos verificados en tiempo real”.

4) Reglas de guardado y validaciones IA

No guardar picks con EV < 10% o con datos incompletos.

Validaciones IA (LIVE y PRE):

apuesta ∈ opciones_apostables válidas.

probabilidad ∈ [5%, 85%].

coherencia con probabilidad implícita ≤ 15 p.p.

Clasificación:

FREE → 10% ≤ EV < 15%

VIP → EV ≥ 15%

Niveles VIP:

🥉 Competitivo: 15–19.9%

🥈 Avanzado: 20–29.9%

🎯 Élite Mundial: 30–39.9%

🟣 Ultra Élite: ≥ 40%

5) EN VIVO — diseño del flujo
5.1 Prefiltro (OddsAPI-first)

Trae eventos live por sport_keys y mercados LIVE_MARKETS (p.ej. h2h,totals,spreads).

Requiere ≥ LIVE_MIN_BOOKIES casas activas.

Calcula consenso (mediana) y mejor oferta (top-3 deduplicado).

Acepta candidatos con gap (implícita consenso − implícita mejor) ≥ LIVE_PREFILTER_GAP_PP (p.p.).

5.2 Enriquecimiento (API-FOOTBALL PRO)

fixtures?live=all → minuto, fase (early, mid, ht, late) y marcador.

Empareja por home/away normalizado y/o por league_id + date (según el script).

(Opc) odds live de respaldo si faltan mercados en OddsAPI.

5.3 IA y EV

IA solo si pasa el prefiltro.

EV calculado vs mejor cuota; validar probabilidad y gap con implícita.

Clasifica en FREE/VIP y genera payload para send.js.

5.4 Anti-duplicado & edición

Anti-duplicado por fixture y bucket de minuto (5’).

Edición del mismo post en VIP/FREE ante gol/roja y cambios relevantes (no spam).

Cooldown por partido LIVE_COOLDOWN_MIN min.

6) Bug de “Sin coincidencias en API-FOOTBALL”: causa y solución
6.1 Causa

El enriquecimiento por búsqueda textual (fixtures?search=) fallaba con algunos equipos/acentos/alias, generando logs:

[evt:...] Sin coincidencias en API-Football

6.2 Solución aplicada

Pre-match (autopick-vip-nuevo.cjs):

Mapa AF_LEAGUE_ID_BY_TITLE (p.ej. "Spain - LaLiga" → 140).

Primero fixtures?date=YYYY-MM-DD&league={id} y match por nombres normalizados (sin acentos/FC/CF…).

Si no aparece, fallback a fixtures?search= (lo de siempre).

Outrights (autopick-outrights.cjs):

Mapa AF_LEAGUE_ID_BY_SPORTKEY (p.ej. soccer_spain_la_liga → 140).

Resolución de liga por /leagues?id= (precisa), con fallback a leagues?search=.

LIVE (autopick-live.cjs):

OddsAPI-first para “qué es apostable” + mejores precios.

AF como índice live para minuto/marcador/fase, con matching normalizado.

Resultado esperado: drástica reducción de falsos “no match” y mayor estabilidad del flujo.

7) Variables de entorno (nuevas y existentes)

Añade en Netlify (Site settings → Environment variables):

# Live tunables
LIVE_MIN_BOOKIES=3
LIVE_POLL_MS=25000
LIVE_COOLDOWN_MIN=8
LIVE_MARKETS=h2h,totals,spreads
LIVE_REGIONS=eu,uk,us
LIVE_PREFILTER_GAP_PP=5
RUN_WINDOW_MS=60000

# OpenAI
OPENAI_MODEL=gpt-5
OPENAI_MODEL_FALLBACK=gpt-5-mini

# Existentes
SUPABASE_URL=...
SUPABASE_KEY=...
ODDS_API_KEY=...
API_FOOTBALL_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=...   # FREE
TELEGRAM_GROUP_ID=...     # VIP

8) Cron y netlify.toml

Ejemplo mínimo para Live (ajusta según tu setup):

[functions."autopick-live"]
  node_bundler = "esbuild"
  included_files = ["netlify/functions/send.js", "prompts_punterx.md"]
  external_node_modules = ["node-fetch", "@supabase/supabase-js", "openai"]
  timeout = 60


Pre/Outrights mantienen sus crons previos. Verifica que los schedules no se solapen en exceso.

9) Supabase — esquema y SQL idempotente

Tabla base: picks_historicos. Si faltan columnas, aplicar:

-- Crear si no existe
CREATE TABLE IF NOT EXISTS public.picks_historicos (
  id bigserial PRIMARY KEY,
  evento text,
  analisis text,
  apuesta text,
  tipo_pick text,                 -- 'PRE' | 'LIVE' | 'OUTRIGHT'
  liga text,
  equipos text,
  ev numeric,
  probabilidad numeric,
  nivel text,
  timestamp timestamptz DEFAULT now()
);

-- Añadir columnas nuevas si faltan
ALTER TABLE public.picks_historicos
  ADD COLUMN IF NOT EXISTS is_live boolean DEFAULT false;

ALTER TABLE public.picks_historicos
  ADD COLUMN IF NOT EXISTS kickoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS minute_at_pick int,
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS score_at_pick text,
  ADD COLUMN IF NOT EXISTS market_point text,
  ADD COLUMN IF NOT EXISTS vigencia_text text,
  ADD COLUMN IF NOT EXISTS top3_json jsonb,
  ADD COLUMN IF NOT EXISTS consenso_json jsonb;

-- Normaliza is_live nulo
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
END $$;

10) package.json (scripts útiles)
{
  "scripts": {
    "pre": "node netlify/functions/autopick-vip-nuevo.cjs",
    "out": "node netlify/functions/autopick-outrights.cjs",
    "live": "node netlify/functions/autopick-live.cjs --loop"
  }
}


Nota: En un monorepo, verifica directorio de trabajo de tu workflow (para evitar errores tipo EJSONPARSE). Solo debe existir un objeto JSON raíz.

11) Operación (Replit vs GitHub/Netlify)

Producción: Netlify Functions + crons.

Replit (opcional): útil como “loop local” para LIVE (npm run live), smoke tests y depuración. No es requisito para producción.

12) Checklist de QA

send.js responde ping y envía a FREE/VIP.

Pre-match: candidatos en ventana 40–55 (fallback 35–70), con enriquecimiento por league_id + date.

Outrights: AF_LEAGUE_ID_BY_SPORTKEY → /leagues?id= → OK.

LIVE: prefiltro por gap y bookies, IA solo si pasa, EV y validaciones, fijado VIP y ediciones controladas.

Supabase: nuevas columnas visibles; guardado correcto (tipo_pick, is_live, minute_at_pick, etc.).

Top-3 sin numeración, mejor en negritas. País antes de liga.

13) Control de cambios (hoy)

FIX: “Sin coincidencias en API-FOOTBALL” → enriquecimiento por league_id + date y matching normalizado (fallback search=).

ADD: autopick-live.cjs (in-play) OddsAPI-first; IA/EV/validaciones; anti-duplicado; mensajes LIVE; edición/pin.

ADD: Variables LIVE_* en Netlify.

UPD: send.js con plantillas PRE/LIVE/OUTRIGHT y top-3 sin numeración.

SQL: columnas y índices idempotentes para LIVE/analíticas.

DOC: este PunterX-Config.md re-sincronizado.

14) Notas finales

Mantener coherencia con los niveles de EV y formatos.

Documentar cualquier cambio en prompts, variables o lógica también aquí.

Evitar spam en LIVE: máx. 3 intervenciones/partido y cooldown activo.

Continuar ampliando mapas de ligas (AF_LEAGUE_ID_BY_*) según cobertura necesaria.

---

## Cambios recientes (Agosto 2025)

- **Integración de OddsAPI como fuente principal de partidos** cada 15 minutos, con validación cruzada en API-FOOTBALL.  
- **Enriquecimiento de datos en IA**: se sumaron alineaciones, clima, árbitro, historial, forma y ausencias para el análisis GPT-5.  
- **Clasificación de picks por EV**: se mantienen niveles (Ultra Élite, Élite Mundial, Avanzado, Competitivo, Informativo).  
- **Canal gratuito activado con picks informativos (10–14% EV)** incluyendo análisis básico y frase motivacional de IA.  
- **Top 3 casas de apuestas** ahora se muestran en los mensajes VIP, ordenadas por cuota.  
- **Frase de responsabilidad** confirmada en picks gratuitos y VIP.  
- **Apuestas extra** ampliadas: más de 2.5 goles, ambos anotan, doble oportunidad, goleador probable, marcador exacto, HT result y hándicap asiático.  
- **Automatización en zona horaria America/Mexico_City**: detección de partidos que comienzan entre 45 y 55 minutos.  
- **Live picks experimentales** iniciados en UK para fase de pruebas (archivo `autopick-live.cjs`).  
- **Supabase**: sigue almacenando picks en `picks_historicos`, sin guardar picks con EV < 14% o datos incompletos.  
- **Corrección en `package.json`**: se arregló un error de coma sobrante que impedía correr `npm ci`.  
- **Manejo de errores**: se añadieron `try/catch` extra para prevenir que `data.find` rompa el flujo cuando API responde inesperadamente.  

---

## Notas de Errores y Soluciones Pendientes (Actualización 16 de agosto 2025)

### Errores detectados en producción
- **"Sin coincidencias en API-FOOTBALL"**: aparece en los logs cuando OddsAPI devuelve partidos que no logran empatarse con un fixture válido en API-FOOTBALL.  
  - Impacto: se pierden posibles picks, incluso cuando hay cuotas disponibles.
- **EJSONPARSE en `package.json`**: error por coma sobrante o malformación de JSON.  
  - Impacto: bloqueó despliegue en GitHub Actions hasta ser corregido.
- **Logs no resueltos**: todavía vemos errores genéricos como `data.find is not a function` en algunos puntos del script maestro.  
  - Impacto: puede frenar ejecución de ciertos picks cuando la respuesta de API no tiene el formato esperado.

### Soluciones implementadas (en espera de verificación)
- Se reforzó el **match entre OddsAPI y API-FOOTBALL** usando normalización de nombres de equipos y fallback por `id` y `date`.  
  - Estado: implementado, pendiente de comprobar si elimina todos los “Sin coincidencias”.
- Se corrigió el **`package.json`** para que sea JSON válido.  
  - Estado: corregido, pendiente de nueva corrida completa de `npm ci` en el pipeline.
- Se agregó un **try/catch adicional en el flujo de partidos** para evitar que `data.find` rompa la ejecución.  
  - Estado: implementado, falta validar en logs de Netlify.
- Se mantuvo el **enfoque inicial en UK para live picks** (archivo `autopick-live.cjs`), como fase experimental antes de expandir regiones.  
  - Estado: activo, esperando feedback de resultados en vivo.

### Pendientes de validación
- Confirmar que la normalización de equipos elimina por completo los errores de emparejamiento OddsAPI ↔ API-FOOTBALL.  
- Verificar si los nuevos try/catch realmente capturan todos los casos donde `data.find` recibe datos inesperados.  
- Testear en ambiente real que el `package.json` corregido despliega sin errores en GitHub Actions y Netlify.  
- Ajustar configuración regional para LATAM en el live cuando se confirme el flujo en UK.

---

