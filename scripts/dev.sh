# ¡Fuente este archivo con:  source scripts/dev.sh !
# No usamos `set -e` aquí para no matar la sesión si falla algo puntual.

# --- Vars por defecto ---
export NL_PORT="${NL_PORT:-9999}"
export NL_LOG="${NL_LOG:-/tmp/netlify.log}"

# --- Ping ---
pingg() {
  curl -sS "http://localhost:${NL_PORT}/.netlify/functions/ping" | jq .
}

# --- Restart netlify dev (espera a ready) ---
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

# --- Toggle de trazas ---
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

# --- Helpers de logs ---
elogs()  { sed -n "/ENRICH\\|enrich\\./p" "${NL_LOG:-/tmp/netlify.log}" | tail -n 120; }
elogsd() { sed -n "/ENRICH\\.delta\\|ENRICH\\.status/p" "${NL_LOG:-/tmp/netlify.log}" | tail -n 80; }
elogsf() { tail -n 0 -f "${NL_LOG:-/tmp/netlify.log}" | sed -n '/ENRICH\|enrich\./p'; }

# --- Oneshot helper ---
oneshot() {
  local H="${1:-Liverpool}" A="${2:-Chelsea}" L="${3:-Premier League}" T="${4:-2025-08-16T16:30:00Z}"
  local URL="http://localhost:${NL_PORT}/.netlify/functions/run-pick-oneshot"
  local BODY; BODY=$(jq -n --arg h "$H" --arg a "$A" --arg l "$L" --arg t "$T" \
    '{evt:{home:$h,away:$a,league:$l,commence:$t}, ai_json:{resumen:"ok"}}')
  curl -sS -H 'content-type: application/json' -d "$BODY" "$URL" \
  | jq '{status:.meta.enrich_status, markets:(.payload.markets|keys?), h2x_len:(.payload.markets["1x2"]|length?)}'
}

# --- Batch demo helpers ---
scan_batch_demo() {
  local URL="http://localhost:${NL_PORT}/.netlify/functions/run-picks-batch"
  local BODY; BODY=$(jq -n '{
    limit: 10,
    events: [
      {home:"Liverpool", away:"Chelsea",   league:"Premier League", commence:"2025-08-16T16:30:00Z"},
      {home:"Arsenal",   away:"Man City",  league:"Premier League", commence:"2025-08-16T16:30:00Z"},
      {home:"Real Madrid", away:"Barcelona", league:"La Liga",      commence:"2025-09-01T19:00:00Z"},
      {home:"Inter",     away:"Juventus",  league:"Serie A",        commence:"2025-09-01T18:45:00Z"}
    ]
  }')
  curl -sS -H 'content-type: application/json' -d "$BODY" "$URL" \
  | jq '{count_in, count_out, top3:(.results[0:3]|map({score, h2x_len, leagues:(.evt.league), fixture:(.evt.home+" vs "+.evt.away)}))}'
}

scan_batch_demo_filters() {
  local URL="http://localhost:${NL_PORT}/.netlify/functions/run-picks-batch"
  local BODY; BODY=$(jq -n '{
    limit: 5,
    min_h2x_len: 3,
    require_markets: ["1x2"],
    events: [
      {home:"Liverpool", away:"Chelsea",   league:"Premier League", commence:"2025-08-16T16:30:00Z"},
      {home:"Arsenal",   away:"Man City",  league:"Premier League", commence:"2025-08-16T16:30:00Z"},
      {home:"Real Madrid", away:"Barcelona", league:"La Liga",      commence:"2025-09-01T19:00:00Z"},
      {home:"Inter",     away:"Juventus",  league:"Serie A",        commence:"2025-09-01T18:45:00Z"}
    ]
  }')
  curl -sS -H 'content-type: application/json' -d "$BODY" "$URL" \
  | jq '{count_in, count_ranked, count_skipped, top:(.results|map({score,score_1x2,h2x_len, fixture:(.evt.home+" vs "+.evt.away), mks:.has_markets, samples:.market_samples})[0:5]), skipped}'
}

# --- Scan (OddsAPI → batch) helpers ---
scan_auto_today_raw() {
  curl -sS "http://localhost:${NL_PORT}/.netlify/functions/run-picks-scan"
}
scan_auto_week_raw() {
  curl -sS "http://localhost:${NL_PORT}/.netlify/functions/run-picks-scan?days_ahead=7&limit=30"
}
scan_auto_today() {
  scan_auto_today_raw | jq '{sports, days_ahead, scan_max, discovered, considered, ranked:(.batch.count_ranked), top:(.batch.results|map({score,h2x_len,fixture:(.evt.home+" vs "+.evt.away), mks:.has_markets})[0:10])}'
}
scan_auto_week() {
  scan_auto_week_raw  | jq '{days_ahead, scan_max, discovered, considered, ranked:(.batch.count_ranked), top:(.batch.results|map({score,h2x_len,fixture:(.evt.home+" vs "+.evt.away)})[0:10])}'
}

# --- Sanity quick check ---
sanity() {
  node -e "const m=require('./netlify/functions/_lib/enrich.cjs'); console.log('ensure =', (m.ensureMarketsWithOddsAPI&&m.ensureMarketsWithOddsAPI.name)||typeof m.ensureMarketsWithOddsAPI);"
  pingg
}

# === Multimercado quick scan (usa run-picks-scan) ===
scan_multi() {
  local DAYS="${1:-2}"
  local LIM="${2:-50}"
  curl -sS "http://localhost:${NL_PORT}/.netlify/functions/run-picks-scan?days_ahead=${DAYS}&limit=${LIM}&min_h2x_len=3&require_markets=1x2"
}

# Top breakdown (score total + desgloses)
scan_multi_top() {
  local DAYS="${1:-2}"
  local LIM="${2:-30}"
  scan_multi "$DAYS" "$LIM" \
  | jq '.batch.results[0:10] | map({score, s1x2:.score_1x2, btts:.score_btts, ou25:.score_ou25, dnb:.score_dnb, fx:(.evt.home+" vs "+.evt.away), mks:.has_markets})'
}
