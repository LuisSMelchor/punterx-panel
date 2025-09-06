#!/usr/bin/env bash
set -u

BASE="http://localhost:8888/.netlify/functions"
Q1="$BASE/diag-af-quick?home=Real%20Madrid&away=Barcelona&when_text=2025-04-20&league_hint=La%20Liga&country_hint=Spain"
W1="$BASE/diag-af-windoweval?home=Real%20Madrid&away=Barcelona&when_text=2025-04-20&league_hint=La%20Liga&country_hint=Spain&pad=14"

okQ=0; okW=0; streakQ=0; streakW=0
end=$((SECONDS+120))

while [ $SECONDS -lt $end ]; do
  codeQ=$(curl -s -o /dev/null -w "%{http_code}" "$Q1")
  codeW=$(curl -s -o /dev/null -w "%{http_code}" "$W1")

  if [ "$codeQ" = "200" ]; then streakQ=$((streakQ+1)); else streakQ=0; fi
  if [ "$codeW" = "200" ]; then streakW=$((streakW+1)); else streakW=0; fi

  if [ $streakQ -ge 3 ]; then okQ=1; fi
  if [ $streakW -ge 3 ]; then okW=1; fi

  echo "[AF_DEBUG] tick=$SECONDS codeQ=$codeQ streakQ=$streakQ | codeW=$codeW streakW=$streakW"

  if [ $okQ -eq 1 ] && [ $okW -eq 1 ]; then
    echo "[AF_DEBUG] HEALTH PASS: ambos handlers llevan >=3 respuestas 200 consecutivas"
    break
  fi
  sleep 5
done

if [ $okQ -ne 1 ] || [ $okW -ne 1 ]; then
  echo "[AF_DEBUG] HEALTH WARN: no se alcanzó estabilidad (>=3x200 seguidas) en la ventana de tiempo"
fi
