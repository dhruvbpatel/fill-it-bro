#!/usr/bin/env bash
# Launch the Electron desktop app against the Angular fixture form.
#
#   ./scripts/start-desktop.sh                 # real service on :8787 (start-service.sh first)
#   FIB_API=fake ./scripts/start-desktop.sh    # canned responses, no service needed
#
# Extra args are passed to the app, e.g.:
#
#   ./scripts/start-desktop.sh --dealId=7 --formId=fixtureDeal

set -euo pipefail
cd "$(dirname "$0")/.."

# Unset if inherited from editor/terminal environment so Electron starts as an app, not Node.
unset ELECTRON_RUN_AS_NODE

FIXTURE_PORT="${FIXTURE_PORT:-4300}"
FIXTURE_URL="http://localhost:$FIXTURE_PORT"

if [[ ! -d node_modules ]]; then
  echo "error: dependencies are not installed. Run: pnpm install" >&2
  exit 1
fi

start_fixture() {
  echo "fixture form: starting on $FIXTURE_URL (ng serve, first start takes ~20s)..."
  (pnpm fixture:serve > /tmp/fib-fixture.log 2>&1 &) 
  for i in $(seq 1 60); do
    if curl -sf "$FIXTURE_URL" >/dev/null 2>&1; then
      echo "fixture form: ready at $FIXTURE_URL"
      return 0
    fi
    sleep 1
  done
  echo "error: fixture form did not start within 60s — see /tmp/fib-fixture.log" >&2
  return 1
}

if curl -sf "$FIXTURE_URL" >/dev/null 2>&1; then
  echo "fixture form: already running at $FIXTURE_URL"
  STARTED_FIXTURE=0
else
  start_fixture
  STARTED_FIXTURE=1
fi

cleanup() {
  if [[ "${STARTED_FIXTURE:-0}" -eq 1 ]]; then
    pkill -f "ng serve --port $FIXTURE_PORT" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

export FIB_SERVICE_URL="${FIB_SERVICE_URL:-http://localhost:8787}"
echo "desktop: FIB_SERVICE_URL=$FIB_SERVICE_URL ${FIB_API:+FIB_API=$FIB_API }launching..."
pnpm --filter desktop dev -- --dealId=1 --formId=fixtureDeal "$@"
