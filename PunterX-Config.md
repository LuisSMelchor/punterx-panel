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
