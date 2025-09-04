#!/usr/bin/env bash
set -euo pipefail

# Carpeta raíz del repo
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Archivos a revisar (excluye node_modules y build outputs comunes)
mapfile -t FILES < <(git ls-files | grep -Ev '^(node_modules/|dist/|build/|.next/|coverage/)' )

# Reglas heurísticas (case-insensitive) que apuntan a patrones comunes de nombres
# * No enumeramos equipos concretos en el código de negocio; esto solo es una cerca para tests/scripts.
PATTERNS=(
  # formas genéricas muy comunes en nombres de clubes
  '\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+(FC|CF|AC|SC|United|City|County|Athletic|Atletico|Sporting|Deportivo|Rangers|Wanderers|Dynamos?)\b'
  '\b(Real|Atletico|Sporting|Deportivo)\s+[A-Z][a-z]+'
  '\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s+(Giants|Galaxy|Fire|Revolution|Earthquakes|Timbers|Sounders|Crew|Red\s?Bulls)\b'
  # ligas reales comunes
  '\b(Major\s+League\s+Soccer|Premier\s+League|La\s+Liga|Serie\s+A|Bundesliga|Ligue\s+1|MLS\s+Next\s+Pro|USL\s+Championship)\b'
)

violations=0
for f in "${FILES[@]}"; do
  # Saltar binarios
  if file "$f" | grep -qi 'binary'; then continue; fi
  for rx in "${PATTERNS[@]}"; do
    if grep -Ein "$rx" "$f" >/dev/null 2>&1; then
      echo "[HARD-CODED?] $f : patrón '${rx}'" >&2
      violations=$((violations+1))
    fi
  done
done

if [[ $violations -gt 0 ]]; then
  echo "[FAIL] Detectados posibles nombres fijos (${violations}). Revisa tests/scripts para usar nombres sintéticos." >&2
  exit 1
fi

echo "[OK] Sin entidades deportivas fijas aparentes en tests/scripts."
