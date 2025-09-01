#!/usr/bin/env bash
set -euo pipefail
BASE="http://localhost:9999/.netlify/functions/run-pick-oneshot"
BODY='{"evt":{"home":"Liverpool","away":"Chelsea","league":"Premier League","commence":"2025-08-16T16:30:00Z"},
       "ai_json":{"resumen":"ok","ev_estimado":0.18,"ap_sugerida":{"mercado":"1X2","pick":"Home","cuota":2.05},"probabilidad":0.56}}'

echo "== default (resolver puede fallar) =="
curl -sS -X POST -H 'content-type: application/json' -d "$BODY" "$BASE" | jq .

echo "== bypass de envío desactivado (SEND_ENABLED=0) =="
SEND_ENABLED=0 curl -sS -X POST -H 'content-type: application/json' -d "$BODY" "$BASE" | jq .
