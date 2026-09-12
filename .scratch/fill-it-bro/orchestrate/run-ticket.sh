#!/usr/bin/env bash
# Run ONE ticket agent in its existing worktree, retrying on provider rate limits.
# Usage: run-ticket.sh NN [model]
# Behavior (learned 2026-09-05): parallel waves hit zai-coding-plan rate limits and
# agents die mid-run (sometimes leaving hung opencode processes). This wrapper:
#   - launches opencode in ../tNN (worktree must already exist),
#   - if the log ends with "Rate limit reached", waits RATE_LIMIT_COOLDOWN (default 300s)
#     and relaunches, up to MAX_ATTEMPTS (default 5). Partial work in the worktree is
#     kept; the agent resumes from it.
#   - also sweeps hung opencode processes whose cwd is the worktree before relaunch.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
NN="$1"
MODEL="${2:-zai-coding-plan/glm-5.3-flash}"
WT="$REPO_ROOT/../t$NN"
LOG="$HERE/logs/T$NN.log"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-5}"
COOLDOWN="${RATE_LIMIT_COOLDOWN:-300}"
[ -d "$WT" ] || { echo "worktree $WT missing"; exit 1; }
PROMPT="$(perl -pe "s/\bNN\b/$NN/g" "$HERE/../PROMPT.md" | sed -n '/^---$/,$p' | tail -n +2)"
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  # sweep hung opencode processes from prior attempts sitting in this worktree
  for pid in $(pgrep -f "opencode run" 2>/dev/null); do
    [ "$(lsof -p "$pid" 2>/dev/null | awk '/cwd/{print $NF}')" = "$WT" ] && kill -9 "$pid" 2>/dev/null
  done
  echo "[$(date +%H:%M:%S)] T$NN attempt $attempt/$MAX_ATTEMPTS (model $MODEL)"
  (
    cd "$WT" && nohup opencode run --auto --model "$MODEL" "$PROMPT" \
      < /dev/null > "$LOG" 2>&1 &
    echo $! > "$LOG.pid"
  )
  AGENT_PID="$(cat "$LOG.pid")"
  while kill -0 "$AGENT_PID" 2>/dev/null; do sleep 20; done
  tail -5 "$LOG" | grep -q "Rate limit reached" || { echo "[$(date +%H:%M:%S)] T$NN finished (attempt $attempt)"; exit 0; }
  echo "[$(date +%H:%M:%S)] T$NN hit rate limit; cooling down ${COOLDOWN}s"
  sleep "$COOLDOWN"
done
echo "T$NN: still rate-limited after $MAX_ATTEMPTS attempts — needs manual attention"
exit 2
