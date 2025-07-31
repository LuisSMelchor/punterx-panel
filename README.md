# 🧠 PunterX | Sistema de Picks Deportivos Automatizado

Bienvenido al backend automatizado de **PunterX**, un sistema inteligente que genera y envía pronósticos deportivos (picks) directamente a Telegram según horarios definidos y lógica de filtrado por ligas.

---

## ⚙️ ¿Qué hace este proyecto?

- Consulta partidos del día desde [API-FOOTBALL](https://www.api-football.com/).
- Filtra el mejor evento según horario y ligas prioritarias.
- Genera un mensaje básico o detallado (VIP) con información de apuestas.
- Envía el pick automáticamente a:
  - 📢 Canal público de Telegram (gratuito)
  - 🔒 Grupo VIP de Telegram (exclusivo)

---

## 🧱 Estructura del Proyecto


netlify/
├── functions/
│ ├── autopick-europe.js # Picks europeos (7am CDMX)
│ ├── autopick-pre-mx.js # Picks Liga MX/Sudamérica (12pm CDMX)
│ ├── autopick-evening.js # Picks tarde-noche (6pm CDMX)
│ └── utils/
│ └── filtrarPartido.js # Lógica de prioridad y selección de partido

---

## ⏱️ Programación de funciones

Las funciones usan cron programado desde `netlify.toml`:

| Función              | Hora CDMX     | Ligas Prioritarias                              |
|----------------------|---------------|--------------------------------------------------|
| `autopick-europe`    | 07:00 a.m.    | Europa                                           |
| `autopick-pre-mx`    | 12:00 p.m.    | Liga MX, CONMEBOL, selecciones                   |
| `autopick-evening`   | 06:00 p.m.    | México, MLS, torneos internacionales, selecciones |

---

## 🔐 Seguridad

- Código de acceso (`authCode`)
- Honeypot para detectar bots
- Firma HMAC SHA256 con `timestamp` y `secret`
- Validación de origen (solo desde el panel web)
- Separación entre picks VIP y gratuitos

---

## 📡 Integración con Telegram

- ✅ Envío automático al canal o grupo según el tipo de pick
- ✅ Usa `node-telegram-bot-api` y Telegram Bot Token

---

## 🛠️ Próximas funciones (etapas futuras)

- Generación automática de análisis (`brief`, `detailed`) usando IA
- Sistema de suscripciones pagadas con control de acceso
- Backup de picks enviados en Supabase
- Panel de estadísticas y rendimiento de pronósticos

---

## 🙌 Autor

**Luis Jesús Sánchez Melchor**  
Creador de PunterX y administrador del canal [@punterxpicks](https://t.me/punterxpicks)

---
docs: primera versión del README.md

