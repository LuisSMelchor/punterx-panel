#!/usr/bin/env bash
set -u

BASE="${BASE:-https://punterx-panel-vip.netlify.app/.netlify/functions}"
TOKEN_RAW="$(printf "%s" "${DEBUG_TOKEN:-}")"
TOKEN="$(printf "%s" "$TOKEN_RAW" | tr -d '\r\n')"
FAIL=0

echo "[AF_DEBUG] BASE=$BASE"
echo "[AF_DEBUG] DEBUG_TOKEN len (trim) = ${#TOKEN}"

if [ -z "$TOKEN" ]; then
  echo "[AF_DEBUG] DEBUG_TOKEN vacío; exporta DEBUG_TOKEN antes de correr el smoke."
  FAIL=1
fi

inspect() {
  local fn="$1"
  local code
  code=$(curl -sS -o "/tmp/${fn}_i.json" -w '%{http_code}' \
    "$BASE/$fn?inspect=1&debug=1" \
    -H "x-debug: 1" -H "x-debug-token: $TOKEN")
  if [ "$code" = "200" ] && jq -e '.hasHandler==true' </tmp/"${fn}"_i.json >/dev/null 2>&1; then
    echo "[AF_DEBUG] $fn inspect OK (200)"
  else
    echo "[AF_DEBUG] $fn inspect FAIL (code=$code)"
    FAIL=1
  fi
}

bypass() {
  local fn="$1"
  local code
  code=$(curl -sS -o "/tmp/${fn}_b.json" -w '%{http_code}' \
    "$BASE/$fn?bypass=1&debug=1" \
    -H "x-debug: 1" -H "x-debug-token: $TOKEN")
  if [ "$code" = "403" ] && jq -e '
      (.error=="forbidden") or
      (.raw=="Forbidden") or
      (.ok==false and (.stage|ascii_downcase)=="auth") or
      ((.reason//"" | ascii_downcase) | test("auth|forbidden"))
    ' </tmp/"${fn}"_b.json >/dev/null 2>&1; then
    echo "[AF_DEBUG] $fn bypass OK (403)"
  else
    echo "[AF_DEBUG] $fn bypass FAIL (code=$code)"
    echo "[AF_DEBUG] Body:"; cat /tmp/"${fn}"_b.json || true
    FAIL=1
  fi
}

# Run suite
inspect diag-impl-call
inspect autopick-vip-run3
bypass diag-impl-call
bypass autopick-vip-run3

# Exit code for CI
if [ "$FAIL" -eq 0 ]; then
  echo "[AF_DEBUG] SMOKE OK"
else
  echo "[AF_DEBUG] SMOKE FAILED"
fi
exit $FAIL
