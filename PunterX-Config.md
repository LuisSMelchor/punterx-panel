# 📄 PunterX — Configuración y Estado Actual (Agosto 2025)

## 1. Resumen del Proyecto
PunterX es un sistema automatizado de generación y envío de pronósticos deportivos con IA. Está diseñado para encontrar picks de alto valor esperado (EV) y clasificarlos en niveles de acceso (VIP y gratuito).  
Opera en modo **serverless** con Netlify Functions, se integra con APIs deportivas de pago (OddsAPI, API-FOOTBALL PRO), IA (OpenAI GPT-5), base de datos en tiempo real (Supabase) y Telegram para distribución.

## 2. Arquitectura General
- **Frontend:** Panel web seguro en Netlify (repositorio GitHub).
- **Backend:** Netlify Functions (`/netlify/functions`) en Node.js 20 con `esbuild`.
- **Base de datos:** Supabase (`picks_historicos`, control de usuarios VIP y memoria IA).
- **Integraciones externas:**
  - OddsAPI (cuotas y mercados).
  - API-FOOTBALL PRO (alineaciones, lesiones, árbitros, historial, clima, etc.).
  - OpenAI GPT-5 (análisis experto, generación de mensajes).
  - Telegram Bot API (envío de mensajes a canal gratuito y grupo VIP).

## 3. Scripts y Funciones Principales
- **`autopick-vip-nuevo.cjs`** → Script maestro de picks pre-match.  
  Flujo:
  1. Obtener partidos con cuotas desde OddsAPI.
  2. Filtrar por ventana de inicio (40–55 min / fallback 35–70 min).
  3. Enriquecer datos con API-FOOTBALL.
  4. Generar análisis con GPT-5 (1 llamada/partido).
  5. Calcular EV y clasificar:
     - 🟣 Ultra Élite: EV ≥ 40% → VIP
     - 🎯 Élite Mundial: 30–39.9% → VIP
     - 🥈 Avanzado: 20–29.9% → VIP
     - 🥉 Competitivo: 15–19.9% → VIP
     - 📄 Informativo: 10–14.9% → Canal gratuito
  6. Enviar a Telegram y guardar en Supabase.
  7. Actualizar memoria IA.
- **`autopick-vip-nuevo-background.cjs`** → Proceso paralelo de apoyo (misma lógica principal).
- **`autopick-outrights.cjs`** → Picks de **apuestas a futuro** (Outrights):
  - Teaser (~7 días antes) → FREE + VIP.
  - Pick final (24 ± 2h antes) → VIP si EV ≥ 15%, FREE si 10–14.9%.
  - Top-3 “Mejores casas para apostar” (nº1 en negritas).
  - Apuestas extra filtradas por mayor probabilidad (umbral configurable).
  - Tagline fijo: "🔎 Datos y cuotas verificados en tiempo real."
- **`analisis-semanal.js`** → Resumen semanal de picks y rendimiento.
- **`verificador-aciertos.js`** → Verifica aciertos de picks ya jugados.
- **`memoria-inteligente.js`** → Mantenimiento y optimización de memoria IA en Supabase.
- **`diagnostico-total.js`** → Panel visual con estado de APIs, BD, funciones y errores.
- **`check-status.js`** → Comprobación ligera y frecuente de estado del sistema.
- **`send.js`** → Endpoint para envío manual de mensajes.

## 4. Configuración de Cron (Netlify)
Según `netlify.toml`:
- `autopick-vip-nuevo` → cada 15 min.
- `autopick-vip-nuevo-background` → cada 15 min.
- `autopick-outrights` → cada 1 h.
- `analisis-semanal` → lunes 12:00.
- `verificador-aciertos` → cada 30 min.
- `memoria-inteligente` → cada hora (min 15).
- `check-status` → cada 10 min.

## 5. Formato de Mensajes
### Canal gratuito (@punterxpicks)
- 📡 RADAR DE VALOR
- Liga + país, equipos, hora estimada.
- Análisis de IA y frase motivacional.
- CTA para unirse al VIP (15 días gratis).
- Mensaje responsable incluido.

**Ejemplo FREE:**
📡 RADAR DE VALOR
🇪🇸 LaLiga — Real Betis vs Valencia
Comienza en 50 minutos aprox.

Los expertos ven un partido igualado, pero con tendencia a pocos goles.
💡 “En el fútbol, los pequeños detalles hacen la diferencia.”

🎁 Únete GRATIS 15 días al VIP → t.me/punterxvip
⚠️ Apostar conlleva riesgo: juega de forma responsable.

markdown
Copiar
Editar

### Grupo VIP (-1002861902996)
- 🎯 PICK NIVEL: [clasificación según EV].
- Liga + país, equipos, hora estimada.
- EV, probabilidad estimada, momio.
- Apuesta sugerida y apuestas extra.
- Análisis de IA avanzada (Datos clave).
- Mejores 3 casas para apostar (nº1 en negritas).
- Tagline de datos verificados en tiempo real.
- Mensaje responsable incluido.

**Ejemplo VIP:**
🎯 PICK NIVEL: Élite Mundial
🇪🇸 LaLiga — Real Betis vs Valencia
Comienza en 50 minutos aprox.

📊 EV: 32% | Probabilidad estimada: 58%
💰 Momio: 2.10

💵 Apuesta sugerida: Real Betis gana
🎯 Apuestas extra: Más de 2.5 goles, Ambos anotan

📌 Datos clave: Betis ha ganado 4 de los últimos 5 en casa, Valencia con bajas en defensa, clima soleado.
🏆 Mejores 3 casas para apostar: Bet365 (2.10), Bwin (2.08), William Hill (2.05)
🔎 Datos y cuotas verificados en tiempo real.

⚠️ Apostar conlleva riesgo: juega de forma responsable.

markdown
Copiar
Editar

### Outrights (Apuestas a futuro)
- **Teaser (~7 días antes)** → anuncia pick VIP a publicarse 24h antes.
- **Final (24 ± 2h antes)** → VIP o FREE según EV.
- Apuestas extra filtradas (máxima probabilidad).
- Top-3 casas de apuestas.
- Datos clave: forma, lesiones, xG, transfers.

**Ejemplo Outrights — Teaser (7 días antes):**
📢 Atención VIP
🏆 LaLiga 2025/26 comienza en 7 días.
🎯 Nuestro pick premium para campeón se publicará 24h antes del inicio.
Mantente atento: analizaremos forma, fichajes, lesiones y estadísticas clave.
🔎 Datos y cuotas verificados en tiempo real.

markdown
Copiar
Editar

**Ejemplo Outrights — Final (24h antes):**
🏆 OUTRIGHT — Campeón LaLiga 2025/26
📊 EV: 28% | Probabilidad estimada: 55%
💰 Momio: 1.90

💵 Apuesta sugerida: Real Madrid campeón
🎯 Apuestas extra: Máximo goleador — Vinícius Jr. (prob. 40%)

📌 Datos clave: plantilla reforzada, inicio de calendario favorable, rivales directos con bajas importantes.
🏆 Mejores 3 casas para apostar: Bet365 (1.90), Bwin (1.88), William Hill (1.87)
🔎 Datos y cuotas verificados en tiempo real.

⚠️ Apostar conlleva riesgo: juega de forma responsable.

markdown
Copiar
Editar

## 6. Memoria IA
- Consulta `picks_historicos` en Supabase antes de generar análisis.
- Aprende de aciertos/errores pasados.
- Evita guardar picks incompletos o con EV negativo.

## 7. Reglas de Filtrado y Guardado
- No guardar picks con EV < 10%.
- No guardar si faltan datos clave (liga, equipos, análisis, cuota).
- Picks FREE: EV 10–14.9%, VIP: EV ≥ 15%.
- Picks Outrights: EV ≥ 15% (VIP), EV 10–14.9% (FREE).

## 8. Mejoras Recientes (Agosto 2025)
- ✅ Mensajes VIP y FREE rediseñados (incluyen momio y top 3 casas).
- ✅ Integración completa de apuestas a futuro (teaser + final).
- ✅ Filtrado de apuestas extra por probabilidad (umbral 45%, máx. 4).
- ✅ Tagline fijo en todos los mensajes.
- ✅ Teaser para Outrights enviado a FREE + VIP.
- ✅ Pick final de Outrights 24 ± 2h antes del inicio del torneo.
- ✅ Mejora en detección de liga y país (API-FOOTBALL).
- ✅ Cron de Outrights ajustado a cada hora.
- ✅ Manejo robusto de errores y reintentos en llamadas a APIs.
- ✅ Logs mejorados para depuración en producción.

## 9. Picks EN VIVO (In‑Play)

### 9.1 Objetivo
Agregar un flujo de señales EN VIVO (in‑play) para detectar “picks mágicos” durante el partido, utilizando OddsAPI (cuotas live), API‑FOOTBALL PRO (minuto, marcador, eventos, árbitro, odds live) y OpenAI (análisis y diagnóstico exprés). El foco está en **oportunidades reales con EV** y **bajo spam**.

### 9.2 Fuentes y ciclo
- **OddsAPI**: descubrimiento de eventos in‑play y cuotas recientes.
- **API‑FOOTBALL PRO**: minuto, estado (fase), marcador, eventos (goles/rojas), odds live de respaldo.
- **OpenAI (GPT‑5)**: una llamada solo si el **prefiltro de valor** (gap consenso vs mejor cuota) sugiere oportunidad.
- **Supabase**: persistencia (histórico + telemetría) y anti‑duplicado.
- **Telegram**: envío de mensajes (FREE/VIP), “fijado” en VIP y **edición** del mismo post.

### 9.3 Criterios de selección (runtime)
1) Partido en **estado live** y con **≥3 bookies activos** en el mercado objetivo.  
2) Mercados elegibles V1: **1X2, Totales, Hándicap asiático** (se amplía luego).  
3) **Señales de juego**: gol/roja, rachas de presión/xThreat, cambios ofensivos/defensivos, patrón de tarjetas del árbitro.  
4) **Prefiltro de valor**: gap > ~5 p.p. entre “consenso” (mediana de 5–8 bookies) y mejor cuota.  
5) **Umbrales** y validaciones:
   - Prob IA ∈ [5%, 85%]
   - Diferencia con implícita ≤ 15 p.p.
   - **EV**: FREE 10–14.9%, **VIP ≥ 15%**
   - Anti‑duplicado por (fixture_id, mercado, point, **bucket de minuto** de 5’)

### 9.4 Ventanas de oportunidad
- **Early (1’–15’)**: ajustes tempranos (totales/handicap).  
- **HT (40’–50’ incluyendo descanso)**: reposicionamientos de línea útiles.  
- **Late (75’–90’(+))**: valor en líneas con volatilidad por cansancio/cierre.

### 9.5 Política anti‑spam
- **Un (1) mensaje por señal** y luego **solo ediciones** del mismo post (salvo cierre/cashout).
- Máximo **3 intervenciones** por partido (Señal → Update opcional → Cierre).
- **Cooldown** ≥ 8–10 min por partido (excepto gol/roja).

### 9.6 Formatos de mensaje EN VIVO

#### 9.6.1 VIP (LIVE_VIP)
🔴 LIVE PICK - {nivel}
🏆 {pais} - {liga} - {equipos}
⏱️ {minuto} | Marcador: {marcador} | Fase: {fase}

EV: {ev}% | Prob. estimada IA: {probabilidad}% | Momio: {momio}

💡 Apuesta sugerida: {apuesta_sugerida}
📌 Vigencia: {vigencia}

Apuestas extra:
{apuestas_extra}

📊 Razonamiento EN VIVO:
{razonamiento}

🏆 Top‑3 casas (mejor resaltada):
{top3}

🧭 Snapshot mercado:
{snapshot}

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder. Recuerda que ninguna apuesta es segura, incluso cuando el análisis sea sólido.

markdown
Copiar
Editar

**Notas:**
- `{nivel}`: 🥉/🥈/🎯/🟣 según EV.  
- `{top3}`: **sin numeración**; #1 en **negritas**.  
- `{snapshot}` ejemplo:
Consenso: 1.96 | Mejor: 2.05 | Volatilidad: media
Disparador: doble cambio ofensivo + amarilla en zona crítica

shell
Copiar
Editar

#### 9.6.2 FREE (LIVE_FREE)
🔴 EN VIVO - RADAR DE VALOR
🏆 {pais} - {liga} - {equipos}
⏱️ {minuto} | Marcador: {marcador} | Fase: {fase}

📊 Análisis en tiempo real:
{razonamiento}

💬 “En vivo, cada jugada puede cambiarlo todo. Aquí es donde nacen las oportunidades.”

🎁 Únete al VIP para ver:

Apuesta sugerida y apuestas extra

EV y probabilidad estimada

Top-3 casas con la mejor cuota

🔎 IA Avanzada, monitoreando el mercado global 24/7 en busca de oportunidades ocultas y valiosas.
⚠️ Este contenido es informativo. Apostar conlleva riesgo: juega de forma responsable y solo con dinero que puedas permitirte perder.

markdown
Copiar
Editar

### 9.7 Envío, fijado y edición
- **VIP**: se **fija** automáticamente en el grupo al enviarse (`pinChatMessage`).  
- **Ambos (FREE/VIP)**: se **editan** con `editMessageText` ante: gol/roja, salto de cuota relevante, cambio de EV o ajuste en “apuestas extra”.  
- Límite de **ediciones** sugerido: cada 2–3 min o ante evento clave (no spam).  

### 9.8 Supabase — esquema y guardado
- Tabla `picks_historicos` (se mantiene) con nuevas columnas sugeridas:
  - `is_live` (bool, default false)
  - `minute_at_pick` (smallint)
  - `score_at_pick` (text)
  - `phase` (text: "early" | "ht" | "late")
  - `market_point` (numeric, opcional para totals/spread)
  - `vigencia_text` (text)
  - `hash_pick` (text, opcional para trazabilidad)
- **Anti‑duplicado LIVE** por `(fixture_id, mercado, point, minute_bucket)`.

### 9.9 Variables de entorno (sugeridas)
- `LIVE_MIN_BOOKIES=3`
- `LIVE_POLL_MS=25000`
- `LIVE_COOLDOWN_MIN=8`
- `LIVE_MARKETS=h2h,totals,spreads`
- `LIVE_REGIONS=eu,uk`
- (Reutiliza `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_GROUP_ID` ya existentes.)

### 9.10 Flujo completo EN VIVO
1) Descubrimiento in‑play → 2) Prefiltro de valor (gap consenso vs mejor) → 3) Llamada IA (si pasa) →  
4) Cálculo EV y validaciones → 5) Clasificación (FREE/VIP) → 6) Envío (VIP fijado) → 7) Ediciones → 8) Cierre → 9) Guardado en Supabase → 10) Memoria IA.

### 9.11 Ligas y alcance
- **Pool inicial**: ligas con **liquidez real** (UCL/UEL, EPL, LaLiga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira, MLS, Libertadores, Sudamericana, etc.).  
- se amplía conforme la memoria IA detecte patrones de valor sostenido.

---

📌 **Última actualización:** 14 de agosto de 2025
