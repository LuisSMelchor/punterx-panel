.PHONY: smoke-prod smoke-local

smoke-prod:
	SMOKE_BASE_URL="https://punterx-panel-vip.netlify.app" \
	SMOKE_INCLUDE_RUN3=1 bash scripts/smoke-functions.sh

smoke-local:
	SMOKE_BASE_URL="http://localhost:8888" \
	bash scripts/smoke-functions.sh
