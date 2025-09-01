#!/usr/bin/env bash
# no usar set -e para no romper pipelines
tmp="/tmp/jq_in.$$"
cat > "$tmp" || true
if ! head -c1 "$tmp" | grep -qE '(\{|\[)'; then
  echo "jq_safe: input no es JSON (primeros 120 líneas abajo):" >&2
  sed -n '1,120p' "$tmp" >&2
  rm -f "$tmp"
  # salir con 0 para no cortar pipes
  exit 0
fi
scripts/jq_safe.sh "$@" < "$tmp"
rm -f "$tmp"
