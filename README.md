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
