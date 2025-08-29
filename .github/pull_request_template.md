## Resumen
Describe brevemente el cambio.

## Checklist Guardrails (obligatorio)
- [ ] **CommonJS** en funciones (sin ESM).
- [ ] Todas las respuestas usan **IIFE `send_report`** dentro de `JSON.stringify({ ... })`.
- [ ] Con `ODDS_ENRICH_ONESHOT=1`: `meta.enrich_attempt`, `meta.odds_source`, `meta.enrich_status`.
- [ ] **`markets_top3`** presente en todas las rutas (incluye paths de error).
- [ ] **Sin secretos** expuestos (solo nombres de variables de entorno).
- [ ] Suite **`npm run verify:all`** en verde localmente.

## Notas/Riesgos
- Riesgos y mitigaciones aquí.

