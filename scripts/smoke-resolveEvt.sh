#!/usr/bin/env bash
set -euo pipefail

URL="http://localhost:9999/.netlify/functions/af-smoke"
IDX_LIST=(${IDX_LIST:-0 3 4 8 9})
OK=0; TOTAL=0

for IDX in "${IDX_LIST[@]}"; do
  TOTAL=$((TOTAL+1))
  HOME=$(jq -r ".response[$IDX].teams.home.name" /tmp/af-smoke-date.json)
  AWAY=$(jq -r ".response[$IDX].teams.away.name" /tmp/af-smoke-date.json)
  LIGA=$(jq -r ".response[$IDX].league.name"    /tmp/af-smoke-date.json)
  COMMENCE=$(jq -r ".response[$IDX].fixture.date" /tmp/af-smoke-date.json)

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
    echo "⚠️  sin match (${ERR:-no_debug})"
  fi
done

echo "----"
echo "resolveEvt OK=$OK / TOTAL=$TOTAL"
# criterio: al menos 2 matches deben resolverse
test $OK -ge 2
