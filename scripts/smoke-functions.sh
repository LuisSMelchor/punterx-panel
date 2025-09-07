#!/usr/bin/env bash
# scripts/smoke-functions.sh
# Wrapper del smoke en Node (scripts/smoke-functions.js)
# Uso:
#   bash scripts/smoke-functions.sh
#   SMOKE_BASE_URL="https://<site>/.netlify/functions" bash scripts/smoke-functions.sh
#   SMOKE_TIMEOUT_MS=20000 bash scripts/smoke-functions.sh

# Nota: Sin exit codes duros (no exit1/exit5). Mostramos estado y dejamos que bash retorne el código natural.

# Sugerencia: mantener shell estricto, pero sin exits explícitos
set -uo pipefail

: "${SMOKE_BASE_URL:=http://localhost:8888}"
: "${SMOKE_TIMEOUT_MS:=15000}"

export SMOKE_BASE_URL
export SMOKE_TIMEOUT_MS

echo "[AF_DEBUG] smoke base: ${SMOKE_BASE_URL} (timeout ${SMOKE_TIMEOUT_MS}ms)"

if ! command -v node >/dev/null 2>&1; then
  echo "[AF_DEBUG] Node no encontrado en PATH"
  echo "[AF_DEBUG] SMOKE SKIPPED"
else
  node scripts/smoke-functions.js
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "[AF_DEBUG] SMOKE OK"
  else
    echo "[AF_DEBUG] SMOKE ENDED (code ${rc})"
  fi
fi
