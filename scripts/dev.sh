# ¡Fuente este archivo con:  source scripts/dev.sh !
# (sin set -e para no matar la sesión al fallar algo puntual)

# Vars por defecto
export NL_PORT="${NL_PORT:-9999}"
export NL_LOG="${NL_LOG:-/tmp/netlify.log}"

pingg() {
  curl -sS "http://localhost:${NL_PORT}/.netlify/functions/ping" | jq .
}

restart() {
  pkill -f "netlify dev"    >/dev/null 2>&1 || true
  pkill -f "node .*netlify" >/dev/null 2>&1 || true
  rm -rf .netlify/functions-serve .netlify/cache .netlify/edge-functions || true
  npx netlify dev --port "${NL_PORT}" > "${NL_LOG}" 2>&1 &
  for i in {1..60}; do
    grep -q "Server now ready on http://localhost:${NL_PORT}" "${NL_LOG}" && break
    sleep 0.5
  done
  pingg
}

trace_on() {
  export DEBUG_TRACE=1
  if grep -q '^DEBUG_TRACE=' .env 2>/dev/null; then
    sed -i 's/^DEBUG_TRACE=.*/DEBUG_TRACE=1/' .env
  else
    echo 'DEBUG_TRACE=1' >> .env
  fi
  echo "[ok] DEBUG_TRACE=1 (logs visibles)"
}

trace_off() {
  export DEBUG_TRACE=0
  if grep -q '^DEBUG_TRACE=' .env 2>/dev/null; then
    sed -i 's/^DEBUG_TRACE=.*/DEBUG_TRACE=0/' .env
  else
    echo 'DEBUG_TRACE=0' >> .env
  fi
  echo "[ok] DEBUG_TRACE=0 (logs silenciados)"
}

oneshot() {
  local H="${1:-Liverpool}" A="${2:-Chelsea}" L="${3:-Premier League}" T="${4:-2025-08-16T16:30:00Z}"
  local URL="http://localhost:${NL_PORT}/.netlify/functions/run-pick-oneshot"
  local BODY
  BODY=$(jq -n --arg h "$H" --arg a "$A" --arg l "$L" --arg t "$T" \
    '{evt:{home:$h,away:$a,league:$l,commence:$t}, ai_json:{resumen:"ok"}}')
  curl -sS -H 'content-type: application/json' -d "$BODY" "$URL" \
  | jq '{status:.meta.enrich_status, markets:(.payload.markets|keys?), h2x_len:(.payload.markets["1x2"]|length?)}'
}

sanity() {
  node -e "const m=require('./netlify/functions/_lib/enrich.cjs'); console.log('ensure =', (m.ensureMarketsWithOddsAPI&&m.ensureMarketsWithOddsAPI.name)||typeof m.ensureMarketsWithOddsAPI);"
  pingg
  oneshot "Liverpool" "Chelsea" "Premier League" "2025-08-16T16:30:00Z"
}

# Logs ENRICH
elogs()  { sed -n '/ENRICH\|enrich\./p' "${NL_LOG:-/tmp/netlify.log}" | tail -n 120; }
elogsd() { sed -n '/ENRICH\.delta\|ENRICH\.status/p' "${NL_LOG:-/tmp/netlify.log}" | tail -n 80; }
elogsf() { tail -n 0 -f "${NL_LOG:-/tmp/netlify.log}" | sed -n '/ENRICH\|enrich\./p'; }
