# PunterX — Documento de referencia

## Objetivo
Desarrollar un sistema integral que genere **picks mágicos** para todos los partidos apostables del mundo, sin hardcodear nombres de equipos o ligas. El flujo general es:  
1. **Recopilar datos** desde OddsAPI y APISport (cuotas, mercados, fechas).  
2. **Normalizar y emparejar** partidos mediante reglas lingüísticas genéricas (ver `match-normalize.cjs`).  
3. **Calcular valor esperado (EV)** y seleccionar apuestas (directa y sugeridas) según umbrales configurables.  
4. **Dividir picks** en categorías (Competitivo, Avanzado, Élite, Ultra) y enviarlos a Telegram (grupos VIP y canal Free).  
5. **Almacenar picks** para reportes semanales y autoaprendizaje.  
6. Mantener **flujo de usuarios** (prueba VIP de 15 días, premium, expirado) y gestionar expiraciones con Supabase.

## Normalización y matching
- No se utilizan listas de nombres fijos; la función `match-normalize.cjs` aplica slugificación, elimina acentos y stopwords (artículos, conectores, sufijos genéricos) y genera una clave única `YYYY-MM-DD_home_vs_away`.  
- El comparador `match-compare.cjs` evalúa similitud de equipos, liga, fecha y país; devuelve un score 0–100 y una decisión booleana según umbrales (≥ 75% y condiciones mínimas).  
- Los diags `diag-match-fixture`, `diag-match-batch` y `diag-match-compare` permiten probar la normalización y comparador en modo seguro.

## Mensajes de Telegram
- Se utilizan plantillas HTML (`send.js`) para mensajes VIP y Free:  
  - **VIP**: indica EV, partido, liga, país, fecha, apuesta directa, sugeridas, bookies y stake.  
  - **Free**: ofrece picks de EV moderado y CTA para activar la prueba VIP.  
- Los mensajes se envían con `tgSendText()` y `parse_mode:"HTML"`. Se respeta el formato de porcentajes de ganancia y clasificación de EV (Competitivo 15–19%, Avanzado 20–29%, Élite 30–39%, Ultra 40%+).

## Gestión de usuarios
- El webhook `tg_trial_webhook.cjs` gestiona `/vip`, `/status` y `/ayuda`.  
- `/vip` activa la prueba VIP de 15 días, genera un enlace de invitación único (TTL configurable) y registra la expiración en Supabase.  
- `/status` indica si el usuario está en trial, premium o expirado; recuerda los días restantes.  
- `admin-grant-vip.cjs` permite otorgar VIP permanente.  
- Los estados se guardan en la tabla `usuarios` de Supabase.

## Cron y reporting
- `cron-run2` programa la ejecución del impl cada X minutos/hora con `auth` inyectado para picks.  
- `cron-match-log` (o `cron-match-log.cjs`) registra en Function Logs cada 15 min las claves y bandas de partidos procesados (monitor de salud).  
- Los reportes semanales (pendientes) se generarán desde los picks almacenados; contarán W/L/P, yield y EV medio y se enviarán al VIP.

## Regla “No duplicar”
Antes de crear un archivo o función nueva, verifica si existe una implementación en el repositorio. Actualiza o mejora la existente en vez de duplicarla. Mantén las librerías (`_lib`) como fuente de verdad y reutiliza helpers (`send.js`, normalizadores, comparadores, Supabase/TG helpers).

## Autoaprendizaje de la IA
- La IA registra para cada pick: {evento/clave, mercado, EV calculado, momio inicial, momio al cierre (CLV), resultado W/L/P, drift de momio, stake sugerido, bookies}.  
- Entrena con estos datos para ajustar umbrales (EV mínimos por mercado/competición), pesos del comparador (equipos/liga/fecha/país) y reglas de stake.  
- **Criterio**: empezar en modo offline (batch semanal), comparar contra baseline; sólo promover a online con A/B controlado.  
- Guardar metadatos de entrenamiento (versión de features, dataset hash, métrica objetivo) para reproducibilidad.

## Informe semanal (reporting)
- Cron semanal (Lunes 12:00 America/Toronto): calcular ROI, hit-rate, EV medio, CLV medio, distribución por mercados y “top picks” de la semana.  
- Publicar resumen en VIP y un extracto en Free; persistir snapshot en Supabase para histórico (versión + timestamp).  
- Incluir tabla de “aprendizajes” (p. ej. mercados con mayor edge sostenida, ligas con ruido alto).

## Supabase — verificación previa de esquemas
- **Siempre** inspeccionar si existe la tabla/columna/índice **antes** de crear o migrar.  
- Mantener migraciones idempotentes; documentar cambios de esquema en el repo.  
- Tablas esperadas (validar existencia antes de tocar): `usuarios`, `picks`, `picks_outcomes`, `reports_weekly`, `events_cache`, `learning_runs`.

## Replit (nota operativa)
- Replit queda reservado para **prototipos** (listeners en vivo, pruebas de throttling/websockets, sandbox de estrategias).  
- No usar Replit en el flujo de producción; se activará cuando retomemos **apuestas en vivo**.

## Mensajes VIP (ajustes previstos)
- Los mensajes VIP podrán **evolucionar** para incluir: Top-3 bookies (con etiquetas/enlaces), valor de momio (decimal/americano/fraccional), límites de stake, rango de EV y notas de riesgo.  
- El formato final se revisará antes del go-live; versionar plantillas y reflejar cambios en la **gestión de usuarios** (trail/premium, caducidad, CTA de upgrade, multi-idioma).  
- Mantener compatibilidad con `parse_mode: "HTML"` y evitar romper el layout en Telegram.
