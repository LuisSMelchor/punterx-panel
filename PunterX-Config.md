# **PunterX – Configuración y Estado Maestro**
*(Última actualización: 12 de agosto de 2025)*

---

## **1. Variables de entorno – Netlify (producción)**  
*(Todas con alcance “All scopes · Same value in all deploy contexts”)*

| Variable | Descripción |
|----------|-------------|
| `API_FOOTBALL_KEY` | API Key de API-Football (API-Sports PRO) |
| `AUTH_CODE` | Código de autenticación interno PunterX |
| `ENABLE_OUTRIGHTS` | Controla si autopick-outrights está activo (`true`/`false`) |
| `MAX_OAI_CALLS_PER_CYCLE` | Límite de llamadas a OpenAI por ciclo |
| `NODE_OPTIONS` | Flags de ejecución Node.js |
| `NODE_VERSION` | Versión Node.js en Netlify |
| `ODDS_API_KEY` | API Key de OddsAPI |
| `OPENAI_API_KEY` | API Key de OpenAI |
| `OPENAI_MODEL` | Modelo OpenAI principal |
| `OPENAI_MODEL_FALLBACK` | Modelo OpenAI de respaldo |
| `OUTRIGHTS_EV_MIN_VIP` | EV mínimo para picks Outrights VIP |
| `OUTRIGHTS_MIN_BOOKIES` | Número mínimo de casas de apuestas para considerar pick Outrights |
| `OUTRIGHTS_MIN_OUTCOMES` | Número mínimo de resultados posibles para Outrights |
| `PANEL_ENDPOINT` | Endpoint para panel seguro PunterX |
| `PUNTERX_SECRET` | Llave secreta interna de seguridad |
| `SUPABASE_KEY` | API Key de Supabase |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHANNEL_ID` | ID del canal gratuito |
| `TELEGRAM_GROUP_ID` | ID del grupo VIP |
| `TZ` | Zona horaria (America/Mexico_City) |
| `WINDOW_FALLBACK_MAX` | Minutos máx. para ventana fallback |
| `WINDOW_FALLBACK_MIN` | Minutos mín. para ventana fallback |
| `WINDOW_MAX` | Minutos máx. ventana principal |
| `WINDOW_MIN` | Minutos mín. ventana principal |
| `WINDOW_MAIN_MIN` | 40 – Inicio ventana principal |
| `WINDOW_MAIN_MAX` | 55 – Fin ventana principal |
| `WINDOW_FB_MIN` | 35 – Inicio ventana fallback |
| `WINDOW_FB_MAX` | 70 – Fin ventana fallback |
| `ENABLE_OUTRIGHTS_INFO` | `true` para loguear info detallada de Outrights |
| `OUTRIGHTS_EXCLUDE` | Filtro de exclusión de competiciones Outrights |
| `OUTRIGHTS_COHERENCE_MAX_PP` | Diferencia máxima en puntos porcentuales para coherencia |
| `OUTRIGHTS_PROB_MIN` | Probabilidad mínima (%) para Outrights |
| `OUTRIGHTS_PROB_MAX` | Probabilidad máxima (%) para Outrights |

---

## **2. Variables de entorno – GitHub (repository secrets)**

| Variable | Descripción |
|----------|-------------|
| `NETLIFY_AUTH_TOKEN` | Token para CLI Netlify |
| `NETLIFY_BUILD_HOOK` | Hook de build para Netlify |
| `NETLIFY_SITE_ID` | ID del sitio Netlify |

---

## **3. Servicios y APIs Activos**

| Servicio | Plan | Costo mensual (CAD) | Fecha de cobro | Estado |
|----------|------|--------------------|----------------|--------|
| **Netlify** | Pago | $26.12 | 8 de cada mes | Activo |
| **Replit** | Hacker Plan | $40.65 | 3 de cada mes | Activo |
| **API-Sports (API-Football PRO)** | PRO | $27.04 | 2 de cada mes | Activo |
| **OddsAPI** | PRO | $42.69 | 3 de cada mes | Activo |
| **OpenAI (ChatGPT Plus)** | Plus | $31.66 | 19 de cada mes | Activo |
| **Supabase** | Free Tier | $0.00 | N/A | Activo |

---

## **4. Estado actual del proyecto**

- **Script maestro:** `autopick-vip-nuevo.cjs`  
  - Corre cada 15 min en zona `America/Mexico_City`.
  - Flujo: **OddsAPI → API-Football (PRO) → GPT-5 → cálculo EV → clasificación → envío a Telegram → guardado en Supabase → memoria IA.**
  - Incluye: top 3 bookies, liga con país, hora "Comienza en X minutos", advertencia de responsabilidad.
  - Filtros activos:
    - Ventana principal: **40–55 min**
    - Ventana fallback: **35–70 min**
    - EV mínimo VIP: **15%**
    - EV mínimo free: **10%**

- **Otros módulos clave:**
  - `autopick-outrights.cjs` → Picks futuros (Winner, Top Scorer, etc.).
  - `diagnostico-total.js` → Dashboard HTML/JSON.
  - `memoria-inteligente.js` → Aprendizaje IA con Supabase.
  - `verificador-aciertos.js` → Registro de resultados.
  - `analisis-semanal.js` → Resumen semanal.
  - `_telemetry.cjs` → Telemetría interna.
  - `send.js` → Envío seguro a Telegram.

- **Bases de datos (Supabase):**
  - Tabla principal: `picks_historicos`  
    Campos: `evento`, `analisis`, `apuesta`, `tipo_pick`, `liga`, `equipos`, `ev`, `probabilidad`, `nivel`, `timestamp`.
  - No guarda picks con EV < 10% o datos incompletos.

---

## **5. Lógica de clasificación EV (VIP)**

| Nivel | Rango EV |
|-------|----------|
| 🟣 Ultra Elite | EV ≥ 40% |
| 🎯 Élite Mundial | 30% ≤ EV < 40% |
| 🥈 Avanzado | 20% ≤ EV < 30% |
| 🥉 Competitivo | 15% ≤ EV < 20% |
| 📄 Informativo (Free) | 10% ≤ EV < 14.9% |

---

## **6. Notas clave**
- **Mercado objetivo:** Latinoamérica y España (alcance global).
- **Enfoque actual:** solo fútbol; expansión futura a NBA y tenis.
- **Prioridad actual:** optimizar memoria IA, estabilidad en producción y diagnósticos claros.
- **Outrights:** actualmente `ENABLE_OUTRIGHTS=true` con logs detallados (`ENABLE_OUTRIGHTS_INFO=true`).
- Todas las funciones críticas están empaquetadas con **esbuild** en Netlify.
- Repositorio GitHub: [LuisSMelchor/punterx-panel](https://github.com/LuisSMelchor/punterx-panel)
- **Modo maestro activo:** Este documento centraliza TODA la configuración y estado del proyecto.  
  Todas las decisiones y cambios técnicos deben reflejarse aquí.

---
