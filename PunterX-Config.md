# PunterX-Config.md
> Documento maestro del **Chat Maestro** (único punto de control).  
> Mantener este archivo sincronizado con los cambios de código / ENV / reglas.

---

## 0) Rol del Chat Maestro
- Este chat coordina **todo**: cambios de código, verificación, despliegues, diagnósticos y prioridades.
- Los archivos operativos se trabajan en sus mirrors legibles (`*.cjs.txt`, `*.js`, `*.md`) cargados en **Archivos del proyecto**.
- No usar chats externos salvo que el rendimiento baje; si se crea uno nuevo, debe heredar este archivo y las mismas reglas.

---

## 1) Flujo de sistema (visión general)
**OddsAPI** → prefiltrado mercados activos →  
**API‑FOOTBALL** (enriquecimiento: árbitro, clima, historial, forma, xG, lesiones) →  
**OpenAI (GPT‑5)** genera **1 JSON** por evento →  
**EV** = ((p × cuota) − 1) × 100 →  
**Clasificación**  
- Canal FREE: EV 10–14.9%  
- VIP: EV ≥15%  (🥉 15–19.9 · 🥈 20–29.9 · 🎯 30–39.9 · 🟣 ≥40%)  
→ **Telegram** (canal y VIP) → **Supabase** (histórico + memoria IA) → **Diagnóstico**.

**Ventana pre‑match:** 40–55 min (fallback 35–70).  
**Outrights:** misma lógica de guardrails (antiduplicado por selección/torneo).

---

## 2) Variables de entorno (ENV canónicas)
> **Regla:** los módulos leen **estos nombres exactos**. Mantén también tus alias viejos si quieres, pero aquí están los canónicos.

### 2.1 Claves y endpoints (requeridas)
| ENV | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_KEY` | API Key de Supabase |
| `OPENAI_API_KEY` | Credencial OpenAI (modelos v5) |
| `ODDS_API_KEY` | Credencial OddsAPI |
| `API_FOOTBALL_KEY` | Credencial API‑FOOTBALL (PRO) |
| `TELEGRAM_BOT_TOKEN` | Bot token de Telegram |
| `TELEGRAM_CHANNEL_ID` | ID canal FREE (@punterxpicks) |
| `TELEGRAM_GROUP_ID` | ID grupo VIP (-1002861902996) |

### 2.2 Modelos y límites (opcionales)
| ENV | Default | Comentario |
|---|---:|---|
| `OPENAI_MODEL` | `gpt-5-mini` | Modelo principal |
| `OPENAI_MODEL_FALLBACK` | `gpt-5` | Fallback IA |
| `MAX_OAI_CALLS_PER_CYCLE` | `40` | Presupuesto de llamadas por ciclo |
| `PREFILTER_MIN_BOOKIES` | `2` | Prefiltro por liquidez |
| `MAX_CONCURRENCY` | `6` | Concurrencia interna |
| `MAX_PER_CYCLE` | `50` | Máx. candidatos por ciclo |
| `SOFT_BUDGET_MS` | `70000` | Corte suave por tiempo |

### 2.3 Ventanas pre‑match (canónicas)
| ENV | Valor actual | Uso |
|---|---:|---|
| `WINDOW_MAIN_MIN` | **40** | Mín principal |
| `WINDOW_MAIN_MAX` | **55** | Máx principal |
| `WINDOW_FB_MIN` | **35** | Mín fallback |
| `WINDOW_FB_MAX` | **70** | Máx fallback |

> **Alias heredados (no leídos por el código actual):** `WINDOW_MIN`, `WINDOW_MAX`, `WINDOW_FALLBACK_MIN`, `WINDOW_FALLBACK_MAX`.  
> Mantenerlos no rompe nada, pero **los efectivos** son los canónicos de la tabla.

### 2.4 Outrights (futuros)
| ENV | Valor actual | Comentario |
|---|---:|---|
| `ENABLE_OUTRIGHTS` | `true/false` | ON para operar |
| `ENABLE_OUTRIGHTS_INFO` | **true** | FREE informativo si no hay VIP |
| `OUTRIGHTS_MIN_BOOKIES` | `3` | Liquidez mínima |
| `OUTRIGHTS_MIN_OUTCOMES` | `8` | Nº mínimo selecciones |
| `OUTRIGHTS_EV_MIN_VIP` | `15` | EV mínimo VIP (%) |
| `OUTRIGHTS_COHERENCE_MAX_PP` | **15** | |p_modelo% − p_implícita%| ≤ 15 p.p. |
| `OUTRIGHTS_PROB_MIN` | **5** | % IA (mín) |
| `OUTRIGHTS_PROB_MAX` | **85** | % IA (máx) |
| `OUTRIGHTS_EXCLUDE` | **`*u19*,*u20*,*friendly*,*reserves*,*...n*,*amateur*`** | exclusiones torneo |

### 2.5 Seguridad y varios
| ENV | Uso |
|---|---|
| `PUNTERX_SECRET` | Firma HMAC opcional para `send.js` |
| `AUTH_CODE` | Acceso protegido (si se usa) |
| `TZ` | Zona horaria (`America/Mexico_City` o `UTC` en build) |
| `NODE_VERSION` / `NODE_OPTIONS` | Config Node/Netlify |

### 2.6 CI/CD (GitHub)
| Secret | Uso |
|---|---|
| `NETLIFY_AUTH_TOKEN` | CLI/acciones |
| `NETLIFY_SITE_ID` | Sitio Netlify |
| `NETLIFY_BUILD_HOOK` | Trigger de build |

---

## 3) Servicios y planes
- **OpenAI** (pago) — modelos v5.  
- **OddsAPI** (pago) — cuotas en tiempo real.  
- **API‑FOOTBALL** (pago PRO) — datos enriquecidos.  
- **Supabase** (free) — histórico, memoria, telemetría.  
- **Netlify** (pago) — hosting + functions + cron.  
- **Replit** (pago) — entorno de pruebas.

---

## 4) Guardrails y reglas de negocio
- **Probabilidad IA**: decimal 0.05–0.85 (equiv. 5–85%).  
- **Coherencia** con implícita: **≤ 15 p.p.**  
- **EV mínimo**:  
  - FREE: 10–14.9%  
  - VIP: ≥15%  
- **`no_pick=true`**: **corta** el flujo (sin reintentos, sin guardar, sin enviar).  
- **Anti‑duplicado**: pre‑match por **evento**; outrights por **torneo + selección**.  
- **Top 3 bookies**: correctos, ordenados desc, resaltar mejor cuota.  
- **Descartar** picks con datos incompletos tras fallback.

---

## 5) Formatos de mensajes (resumen)
**Canal FREE (@punterxpicks)**  
- Título: `📡 RADAR DE VALOR`  
- Liga (con país cuando esté), hora relativa, **análisis breve IA**, **CTA al VIP**, **disclaimer**.

**VIP (grupo −1002861902996)**  
- `🎯 PICK NIVEL`, liga (con país), hora, **EV y prob.**, **apuesta sugerida** + **extras** (goles, BTTS, doble oportunidad, goleador, marcador exacto, HT, hándicap asiático), **top 3 bookies**, datos avanzados (clima, árbitro, lesiones, historial, xG), **disclaimer**.

---

## 6) Cron y funciones (Netlify)
- `autopick-vip-nuevo` — cada **15 min**  
- `autopick-vip-nuevo-background` — cada 15 min (escalonado)  
- `verificador-aciertos` — cada hora  
- `analisis-semanal` — lunes 10:00 UTC  
- `diagnostico-total` — cada 10 min  
- `autopick-outrights` — cada 30 min

---

## 7) Observabilidad y diagnóstico
- **Pre‑match**: en logs aparece  
  `⚙️ Config ventana principal: X–Y min | Fallback: A–B min`  
  y el rastro de prompt:  
  `[PROMPT] source=md|fallback len=<n>` (debe verse **md** si leyó `prompts_punterx.md`).
- **Outrights**: arranque limpio, `openai.model=gpt-5*`, `prompt.source=md|fallback`, cierre sin excepciones.
- **Diagnóstico** (`diagnostico-total`): responder **200** tanto HTML como `?json=1`, sin “undefined”.

**Smoke (manual):**
```bash
# Outrights (no fuerza envíos; útil para ver arranque y origen del prompt)
curl -sS "https://<tu-dominio>/.netlify/functions/autopick-outrights?smoke=1" -H "x-px-smoke: 1"

# Diagnóstico HTML
curl -i https://<tu-dominio>/.netlify/functions/diagnostico-total

# Diagnóstico JSON
curl -i "https://<tu-dominio>/.netlify/functions/diagnostico-total?json=1"
8) Checklists rápidos
8.1 Post‑deploy
✅ Build OK, functions empaquetadas (esbuild).

✅ openai v5 presente (sin “constructor” error).

✅ diagnostico-total 200 (HTML/JSON).

✅ Pre‑match: [PROMPT] source=md, ventana 40–55 / 35–70.

✅ Outrights: ENABLE_OUTRIGHTS=true → arranque limpio, prompt.source visible.

8.2 Guardrails en ejecución (logs)
no_pick=true → “flujo cortado, sin enviar/guardar”.

“pick incompleto tras fallback” → “descartado”.

Coherencia prob/implícita → “ok” o “descartado por >15 p.p.”.

“top 3 bookies” → 3 casas, ordenadas desc por cuota; mejor resaltada.

9) Política de cambios
Cambios pequeños: anotar en este archivo (fecha, función, breve motivo).

Refactors: marcar diffs en mirrors con // [PX-CHANGE].

Antes de producción: advertir riesgos, proponer backup (copiar mirrors actuales).

10) Apéndice: Mapas y tablas
Tablas principales (Supabase):

picks_historicos (evento, análisis, apuesta, tipo_pick, liga, equipos, ev, probabilidad, nivel, timestamp)

picks_outright (torneo, selección, cuota, probabilidad, ev, analisis, activo, timestamp)

Telemetría: cost_telemetry, heartbeats, function_runs

Memoria: memoria_resumen (plan), functions_status, locks

Funciones clave (Netlify):

autopick-vip-nuevo.cjs, autopick-outrights.cjs, send.js, diagnostico-total.js, _telemetry.cjs, autopick-vip-nuevo-background.cjs

Última actualización: 12 Agosto 2025
