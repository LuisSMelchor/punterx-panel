[![CI](https://github.com/LuisSMelchor/punterx-panel/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

# PunterX (Oneshot Odds Enrichment)

## Cómo correr todo en Codespace

```bash
# instalar deps (si hiciera falta)
npm ci || npm i

# correr suite principal (sin red)
npm run verify:send-report

# probar oneshot (enrich module aislado, safe)
npm run test:oneshot

# probar cableado del enrich detrás del flag
npm run test:oneshot-wire

# mapping de markets
npm run test:markets

# telemetría (tolerante a no-emisión)
npm run test:oneshot-meta
npm run test:oneshot-servererror  # soft-fail de IA (200 por defecto)

Flags de entorno (solo NOMBRES, sin secretos)

ODDS_ENRICH_ONESHOT=0|1 — activa el enriquecimiento en run-pick-oneshot.

ODDS_API_KEY — key de OddsAPI (opcional para tests; solo se usa si la seteas).

ODDS_REGIONS — por defecto us,uk,eu,au.

ODDS_SPORT_KEY — fallback de deporte (por defecto soccer).

ODDS_TIMEOUT_MS — timeout para fetch contra OddsAPI (por defecto 8000).

DEBUG_TRACE=0|1 — logs verbosos en consola.

TG_VIP_CHAT_ID / TG_FREE_CHAT_ID — ids de Telegram (no incluyas secretos).

SEND_ENABLED=0|1 — habilita envío (tests lo fuerzan a 0/1 según caso).

Notas

Todo corre 100% en Codespace, sin comandos externos.

Los tests no requieren claves; si pones ODDS_API_KEY, algunos smoke usan la red.

La telemetría en meta es mínima y segura: enrich_attempt, enrich_status.

## API-Football (AF) — Operación y pruebas
[AF_DOCS_V1]

### Variables de entorno (nombres)
- `API_FOOTBALL_KEY` | `APIFOOTBALL_KEY` | `API_FOOTBALL`
- `AF_MATCH_PAD_DAYS`, `SIM_THR`, `MATCH_LEAGUE_WEIGHT`, `MATCH_COUNTRY_WEIGHT`, `AF_LEAGUE_MIN_SIM`, `AF_COUNTRY_MIN_SIM`, `AF_BTEAM_PENALTY`
- `AF_DEBUG`, `AF_VERBOSE`

### Setup rápido
1. Copia `.env.example` a `.env` y coloca **solo** tu clave bajo `API_FOOTBALL_KEY` (sin comillas).
2. Carga el entorno en tu shell:
   `set -a; . ./.env; set +a`

### Smoke reproducible
`node scripts/af-smoke.js`
- Pasa si: `status=200` y `counts.window>0` **o** `h2h.closest` en los 3 casos.

### Logs de depuración
- Usa `AF_DEBUG=1` para ver trazas con prefijo `[AF_DEBUG]`.
- Sin `AF_DEBUG`, no se imprime ruido.

### Notas
- Handlers: `netlify/functions/diag-af-quick.cjs`, `netlify/functions/diag-af-windoweval.cjs`.
- Cambios mínimos, con sentinelas e idempotentes.

