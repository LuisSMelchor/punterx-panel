# 📄 PunterX Config — Estado, Avances y Histórico de Cambios  
**Última actualización:** 14 de agosto de 2025  

---

## 🗓 Contexto Actual
- **Proyecto:** PunterX — sistema automatizado de picks deportivos con IA.  
- **Estado:** Producción activa en Netlify Functions con ejecución programada (CRON) y endpoints HTTP públicos.  
- **Script principal:** `autopick-vip-nuevo.cjs` ejecutándose cada 15 minutos (America/Mexico_City).  
- **Objetivo:** Detectar y enviar picks de alto valor esperado (EV) usando OddsAPI + API-FOOTBALL PRO + análisis GPT-5, con registro en Supabase y envío diferenciado a Telegram.

---

## ⚙ Arquitectura
- **Frontend:** Panel en Netlify (`punterx-panel-vip.netlify.app`).  
- **Backend:** Netlify Functions (serverless).  
- **Base de datos:** Supabase.  
- **Fuentes de datos:**
  - **OddsAPI:** Fuente principal de partidos y cuotas.
  - **API-FOOTBALL PRO:** Datos avanzados (alineaciones, clima, árbitros, historial, forma, lesiones).  
  - **OpenAI GPT-5:** Análisis y predicciones.
- **Mensajería:** Bot de Telegram (canal público y grupo VIP).  
- **Zona horaria:** America/Mexico_City (ejecuciones) y America/Toronto (diagnóstico ajustable).

---

## 📜 Archivos clave
- `autopick-vip-nuevo.cjs` → Script maestro picks pre-match.  
- `autopick-vip-nuevo-background.cjs` → Ejecuciones en segundo plano.  
- `autopick-outrights.cjs` → Picks a largo plazo.  
- `send.js` → Envió manual de mensajes.  
- `diagnostico-total.js` + `_diag-core-v4.cjs` → Endpoint de diagnóstico web.  
- `verificador-aciertos.js` → Verificación de resultados.  
- `memoria-inteligente.js` → Optimización de memoria IA.  
- `analisis-semanal.js` → Resumen semanal.  
- `netlify.toml` → Configuración unificada (build, funciones, CRON).  
- `prompts_punterx.md` → Prompts optimizados para GPT-5.

---

## 🛠 Cambios y Mejoras Recientes
### 1. Problema con la URL de diagnóstico
- **Síntoma:** Al acceder a `/.netlify/functions/diagnostico-total` devolvía:  
Internal Error. ID: XXXXX

markdown
Copiar
Editar
- **Causas encontradas:**
- Falta de `global.fetch` en entorno Netlify.
- Doble declaración de funciones (`nowISO`) → colisión en bundle.
- Configuración duplicada en `netlify.toml`.
- **Solución aplicada:**
- Polyfill de `fetch` en `diagnostico-total.js`.
- Renombrado de funciones internas.
- Consolidación de configuración en `netlify.toml`.
- Actualización a Node 20 (`NODE_VERSION="20"`, `AWS_LAMBDA_JS_RUNTIME=nodejs20.x`).
- Limpieza de caché y redeploy.

---

### 2. Mejoras visuales y métricas en diagnóstico
- **Agregado:**
- Estado de APIs (Supabase, OpenAI, OddsAPI, API-FOOTBALL, Telegram).
- Métricas de picks: enviados VIP, enviados Free, descartados, EV promedio, top ligas.
- Actividad reciente: últimos 30 picks con datos clave.
- Errores recientes.
- **Formatos soportados:**
- HTML visual (`/.netlify/functions/diagnostico-total`).
- JSON (`?json=1`).
- Ping rápido (`?ping=1`).
- Modo profundo (`?deep=1`).

---

### 3. Ajustes `netlify.toml`
- Unificación en un solo bloque por función.
- Conservación **total** de CRON jobs originales.
- Inclusión optimizada de `included_files` y `external_node_modules`.

---

### 4. Migración Node.js
- Node 20 como versión oficial.
- Polyfills para compatibilidad.

---

## 📊 Estado actual de la URL de diagnóstico
- **URL:** [https://punterx-panel-vip.netlify.app/.netlify/functions/diagnostico-total](https://punterx-panel-vip.netlify.app/.netlify/functions/diagnostico-total)  
- **Estado:** Activa.  
- **Datos mostrados:**
- Estado de APIs.
- Variables de entorno (enmascaradas).
- Picks recientes y métricas.
- Errores y telemetría.

---

## 📅 Bitácora de desarrollo y errores

| Fecha       | Evento / Cambio | Resultado |
|-------------|----------------|-----------|
| 2025-08-12  | Error inicial en URL (`Internal Error`) | Detectado problema `fetch` y colisión `nowISO`. |
| 2025-08-13  | Migración a `_diag-core-v4.cjs`, polyfill `fetch` | URL operativa. |
| 2025-08-13  | Error `netlify.toml` por redefinir clave | Eliminados duplicados, cron intactos. |
| 2025-08-14  | Node 20 y `AWS_LAMBDA_JS_RUNTIME=nodejs20.x` | Ejecución estable. |
| 2025-08-14  | Métricas de picks, telemetría y errores en diagnóstico | HTML con datos en tiempo real. |

---

## 📦 Histórico de despliegues y configuración (Netlify)
| Fecha/Hora (UTC) | Acción | Archivos afectados | Notas |
|------------------|--------|-------------------|-------|
| 2025-08-12 18:45 | Deploy manual | `diagnostico-total.js`, `_diag-core-v4.cjs` | Primer intento de fix en diagnóstico. |
| 2025-08-13 02:10 | Deploy con clear cache | `netlify.toml` | Corrección de bloque duplicado. |
| 2025-08-13 16:25 | Deploy automático (Git push) | `diagnostico-total.js` | Polyfill de `fetch` aplicado. |
| 2025-08-14 01:40 | Deploy manual | `diagnostico-total.js`, `_diag-core-v4.cjs` | Agregado de métricas y telemetría. |
| 2025-08-14 14:20 | Deploy con clear cache | Todos | Consolidación Node 20 y ajustes finales. |

---

## 🚀 Próximos pasos
1. Mejorar diagnóstico:
 - Filtros por fecha/tipo de pick.
 - Exportación CSV/JSON.
 - Gráficos interactivos EV/aciertos.
2. Optimizar funciones:
 - Cacheo API-Football.
 - Reducir llamadas repetidas.
3. Seguridad:
 - Autenticación opcional en diagnóstico.
 - Más enmascaramiento de datos.
