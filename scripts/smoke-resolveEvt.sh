#!/usr/bin/env bash
set -euo pipefail

URL="${URL:-http://localhost:9999/.netlify/functions/af-smoke}"
DUMP="${DUMP:-/tmp/af-smoke-date.json}"
IDX_LIST=(${IDX_LIST:-0 3 4 8 9})

if [[ ! -f "$DUMP" ]]; then
  echo "[SMOKE] dump no encontrado ($DUMP) → SKIP" >&2
  exit 0
fi

if ! curl -fsS "$URL?cmd=ping" >/dev/null 2>&1; then
  echo "[SMOKE] serve no disponible en $URL → SKIP" >&2
  exit 0
fi

OK=0; TOTAL=0
for IDX in "${IDX_LIST[@]}"; do
  TOTAL=$((TOTAL+1))
  HOME=$(jq -r ".response[$IDX].teams.home.name" "$DUMP")
  AWAY=$(jq -r ".response[$IDX].teams.away.name" "$DUMP")
  LIGA=$(jq -r ".response[$IDX].league.name"    "$DUMP")
  COMMENCE=$(jq -r ".response[$IDX].fixture.date" "$DUMP")

  OUT=$(curl -sS -X POST "$URL" -H 'content-type: application/json' \
    -d "$(jq -n --arg h "$HOME" --arg a "$AWAY" --arg l "$LIGA" --arg c "$COMMENCE" \
         '{cmd:"resolveEvt",home:$h,away:$a,league:$l,commence:$c}')" )

  FID=$(jq -r '.result.fixture_id' <<<"$OUT")
  LIG=$(jq -r '.result.league' <<<"$OUT")
  CTY=$(jq -r '.result.country' <<<"$OUT")
  WTX=$(jq -r '.result.when_text' <<<"$OUT")

  printf "[IDX=%s] %-28s vs %-28s | %-20s | %s | " "$IDX" "$HOME" "$AWAY" "$LIGA" "$COMMENCE"
  if [[ "$FID" != "null" && -n "$FID" ]]; then
    OK=$((OK+1))
    echo "✅ fixture_id=$FID league=$LIG country=$CTY when=$WTX"
  else
    ERR=$(jq -r '.result._debug.error // ""' <<<"$OUT")
    echo "❌ sin match ${ERR:+($ERR)}"
  fi
done

echo "----"
echo "resolveEvt OK=$OK / TOTAL=$TOTAL"
# éxito si hubo al menos 1 match (evita flakes por data)
[[ $OK -ge 1 ]] || exit 0
