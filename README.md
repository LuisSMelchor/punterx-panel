
> 🗑️ **Los antiguos archivos `autopick-europe`, `autopick-pre-mx` y `autopick-evening` han sido eliminados.**
Todo se centraliza ahora en `autopick-vip.js`.

---

## ⏱️ Programación de funciones

Usamos funciones programadas (cron jobs) desde `netlify.toml`:

| Función              | Frecuencia         | Descripción                                       |
|----------------------|--------------------|---------------------------------------------------|
| `autopick-vip`       | Cada 15 minutos    | Analiza el mundo completo, filtra picks por EV    |
| `verificador-aciertos` | Diario a las 23:59 | Revisa picks enviados y su resultado (próximamente) |

---

## 🧠 Inteligencia Artificial (IA)

- Generación automática de análisis detallado (OpenAI GPT-4)
- Evaluación contextual: forma, árbitro, clima, historial, alineaciones, lesiones
- Propuesta de apuestas adicionales si hay señales claras
- Inserción de resumen histórico reciente (memoria en Supabase) para aprendizaje adaptativo (en progreso)

---

## 📊 Clasificación de Picks

| Nivel         | EV estimado       | Destino        |
|---------------|-------------------|----------------|
| 🎯 Élite      | EV ≥ 30%          | Grupo VIP      |
| 🥈 Avanzado   | 20% ≤ EV < 30%     | Grupo VIP      |
| 🥉 Competitivo| 15% ≤ EV < 20%     | Grupo VIP      |
| 📄 Informativo| EV = 14%          | Canal gratuito |

---

## 🔐 Seguridad

- Código de acceso personalizado (`authCode`)
- Honeypot para prevenir bots automatizados
- Firma HMAC SHA256 con `timestamp` y `secret` compartido
- Validación de origen: solo desde el panel autorizado
- Separación clara entre picks gratuitos y VIP

---

## 📡 Integración con Telegram

- ✅ Envío automático al canal o grupo VIP con mensajes diferenciados
- ✅ Generación de teaser gratuito y análisis completo para VIP
- ✅ Eliminación automática de duplicados por `fixture.id`
- ✅ Prueba gratuita de 15 días gestionada por bot + Supabase (en Replit)

---

## 🧠 Memoria Inteligente (en desarrollo)

- Supabase guarda todos los picks enviados con:
  - Liga, EV, análisis, equipos, cuotas, probabilidad estimada
- En breve: función `getMemorySummaryFromSupabase()` resumirá patrones y se integrará al `prompt` de OpenAI para que la IA aprenda de aciertos y errores pasados

---

## 🔮 Próximos pasos

- Implementar y probar `getMemorySummaryFromSupabase()`
- Agregar rendimiento semanal (newsletter automatizado)
- Integrar sistema de pagos y control de membresía
- Enriquecer estadísticas de Supabase para visualización
- Sistema experto basado en retroalimentación de éxito histórico

---

## 🙌 Autor

**Luis Jesús Sánchez Melchor**  
Creador y administrador de [@punterxpicks](https://t.me/punterxpicks)  
Coordinador general del sistema PunterX

---

**docs:** actualización agosto 2025 – versión avanzada con IA, EV y Supabase
