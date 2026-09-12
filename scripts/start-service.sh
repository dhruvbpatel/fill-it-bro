#!/usr/bin/env bash
# Start the Python extraction service (FastAPI) for local development.
#
# Works with any OpenAI-compatible endpoint (OpenAI, GLM/Zhipu, OpenRouter, ...):
#
#   export GATEWAY_API_KEY="sk-..."                       # required (unless PROVIDER=fake)
#   export GATEWAY_BASE_URL="https://api.openai.com/v1"   # optional, this default
#   export MODEL="gpt-4o"                                 # optional, this default
#   ./scripts/start-service.sh
#
# Example — GLM via Zhipu's OpenAI-compatible API:
#
#   GATEWAY_BASE_URL="https://open.bigmodel.cn/api/paas/v4" \
#   GATEWAY_API_KEY="..." MODEL="glm-4.7" ./scripts/start-service.sh
#
# Credential-free (canned responses, no LLM calls):
#
#   PROVIDER=fake ./scripts/start-service.sh

set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
PROVIDER="${PROVIDER:-openai}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-https://api.openai.com/v1}"
MODEL="${MODEL:-gpt-4o}"

if [[ "$PROVIDER" != "fake" && -z "${GATEWAY_API_KEY:-}" ]]; then
  echo "error: GATEWAY_API_KEY is not set." >&2
  echo "  export GATEWAY_API_KEY=\"sk-...\"   # any OpenAI-compatible key" >&2
  echo "  (or run: PROVIDER=fake ./scripts/start-service.sh for canned responses)" >&2
  exit 1
fi

if [[ ! -d .venv ]] && ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is not installed (https://docs.astral.sh/uv/)." >&2
  exit 1
fi

echo "service: http://localhost:$PORT (provider=$PROVIDER model=$MODEL base_url=$GATEWAY_BASE_URL)"
export PORT PROVIDER GATEWAY_BASE_URL MODEL GATEWAY_API_KEY
uv run fib-service &
SERVICE_PID=$!

cleanup() { kill "$SERVICE_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
    echo "ready: http://localhost:$PORT (/healthz ok)"
    wait "$SERVICE_PID"
    exit 0
  fi
  if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    echo "error: service exited during startup." >&2
    exit 1
  fi
  sleep 1
done

echo "error: service did not become healthy within 30s (http://localhost:$PORT/healthz)." >&2
exit 1
