#!/usr/bin/env bash
set -euo pipefail

# Archivos de código PRODUCTIVO (JS/CJS/MJS) en netlify/functions, excluyendo diag, holds, backups y normalize.cjs
mapfile -t FILES < <(
  find netlify/functions -type f \( -name "*.js" -o -name "*.cjs" -o -name "*.mjs" \) \
    ! -path "netlify/functions._hold/*" \
    ! -path "netlify/functions/_hold/*" \
    ! -path "netlify/functions.bak.*/*" \
    ! -name "*.bak*" \
    ! -name "diag-*.cjs" \
    ! -name "diag-*.js" \
    ! -name "send.js" \
    ! -path "netlify/functions/_lib/normalize.cjs" \
    -print
)

# SOLO strings literales (", ', `)
QUOTE_RE='(["'"'"'`])([^"'"'"'`]|\\.)*\1'

# Patrones de EQUIPOS (NO ligas; NO 'Real ' genérico para evitar español "real …")
TEAM_PATTERNS=(
  'Manchester City'
  'Man City'
  'Arsenal'
  'Atletico [A-Z][a-z]+'
  'Sporting [A-Z][a-z]+'
  'Deportivo [A-Z][a-z]+'
  'Galaxy'
  'Fire'
  'Revolution'
  'Earthquakes'
  'Timbers'
  'Red[[:space:]]?Bulls'
  'Wanderers'
  'Rangers'
  'Dynamos?'
)

violations=0
for f in "${FILES[@]}"; do
  # saltar binarios
  if file "$f" | grep -qi 'binary'; then continue; fi

  # extraer solo strings
  STRINGS=$(grep -Eno "$QUOTE_RE" "$f" || true)

  for p in "${TEAM_PATTERNS[@]}"; do
    if grep -Eqi "$p" <<<"$STRINGS"; then
      echo "[HARD-CODED?] $f : equipo '$p' detectado en string literal" >&2
      violations=$((violations+1))
    fi
  done
done

if [[ $violations -gt 0 ]]; then
  echo "[FAIL] Posibles equipos hardcodeados en código de producción (${violations})." >&2
  exit 1
fi

echo "[OK] netlify/functions sin equipos hardcodeados aparentes."
