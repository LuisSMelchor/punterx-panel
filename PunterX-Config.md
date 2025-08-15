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

---
📌 **Última actualización:** 14 de agosto de 2025
