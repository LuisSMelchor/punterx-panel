#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-9999}"
OUT="${OUT:-/tmp/af-smoke-date.json}"

# Si no hay API_FOOTBALL_KEY, mejor skip silencioso (usaremos un dump inexistente → el smoke lo saltará)
if [[ -z "${API_FOOTBALL_KEY:-}" && -z "${API_FOOTBALL:-}" && -z "${APIFOOTBALL_KEY:-}" ]]; then
  echo "[CI] API-Football key ausente → SKIP generar dump"
  exit 0
fi

# Detecta D por diag-odds-events y hace fixturesByDate → guardado local
SPORT_KEY=$(curl -fsS "http://localhost:${PORT}/.netlify/functions/diag-env" | jq -r '.ODDS_SPORT_KEY // .SPORT_KEY // "soccer"')
RAW=$(curl -fsS -X POST "http://localhost:${PORT}/.netlify/functions/diag-odds-events" \
  -H 'content-type: application/json' \
  -d "{\"sport_key\":\"${SPORT_KEY}\",\"regions\":\"us,uk,eu,au\",\"days_ahead\":2,\"limit\":20}")
D=$(echo "$RAW" | jq -r '.first[0].commence_time // .events[0].commence_time // .[0].commence_time' | cut -c1-10)

curl -fsS -X POST "http://localhost:${PORT}/.netlify/functions/af-smoke" \
  -H 'content-type: application/json' \
  -d "{\"cmd\":\"fixturesByDate\",\"date\":\"$D\"}" \
  | tee "$OUT" >/dev/null

echo "[CI] dump listo en $OUT"
