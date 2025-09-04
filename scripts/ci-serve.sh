#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-9999}"
LOG="${LOG:-/tmp/punterx-serve.log}"

# Arranca serve en background
netlify functions:serve --port "$PORT" >"$LOG" 2>&1 &
PID=$!

# Espera ping
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:${PORT}/.netlify/functions/ping" >/dev/null 2>&1; then
    echo "[CI] serve OK (pid=$PID)"
    exit 0
  fi
  sleep 1
done

echo "[CI] serve no respondió, dump de logs:"
tail -n 200 "$LOG" || true
exit 1
