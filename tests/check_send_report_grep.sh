#!/usr/bin/env bash
set -euo pipefail
F="netlify/functions/run-pick-oneshot.cjs"

# 1) No shorthand ni literales conflictivos
if grep -nE "^\s*send_report\s*,?\s*$" "$F" >/dev/null; then
  echo "Shorthand detectado"; exit 1
fi
if grep -nE "send_report\s*:\s*\{[^}]*\}" "$F" >/dev/null; then
  echo "Literal conflictivo detectado"; exit 1
fi

# 2) No missing_* a pelo sobre send_report (permitimos base.missing_* en IIFE)
if grep -nE "send_report\s*\.\s*missing_(vip|free)_id\s*=\s*true\b" "$F" >/dev/null; then
  echo "Asignación a pelo detectada"; exit 1
fi

# 3) IIFE presente en todos los JSON.stringify
JS_COUNT=$(grep -c "JSON.stringify({" "$F" || true)
SR_COUNT=$(grep -c "send_report: (() => {" "$F" || true)
if [[ "$JS_COUNT" -ne "$SR_COUNT" ]]; then
  echo "Faltan IIFE de send_report en algún JSON.stringify"; exit 1
fi

echo "OK: grep checks"
