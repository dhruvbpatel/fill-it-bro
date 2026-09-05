#!/usr/bin/env bash
# Launch one headless OpenCode agent per frontier ticket, each in its own git worktree.
# Usage: ./dispatch-opencode.sh [--auto] [--model provider/model] [--dry-run] [NN ...]
# Run from the repository root on an up-to-date main. Logs land in .scratch/fill-it-bro/orchestrate/logs/.
# OpenCode has no --worktree flag: this script does `git worktree add ../tNN -b tNN origin/main` itself.
# --auto approves any permission not explicitly denied; only safe inside disposable ../tNN worktrees.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
MODEL="zai-coding-plan/glm-5.3"; AUTO=0; DRY=0; PICK=()
AUTO_FLAG=()
while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO=1; shift;;
    --model) MODEL="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    *) PICK+=("$1"); shift;;
  esac
done
[ "$AUTO" = 1 ] && AUTO_FLAG=(--auto)
mkdir -p "$HERE/logs"
if [ ${#PICK[@]} -eq 0 ]; then
  while IFS= read -r n; do [ -n "$n" ] && PICK+=("$n"); done < <("$HERE/frontier.py" --json | python3 -c 'import json,sys;[print(t["num"]) for t in json.load(sys.stdin)]')
fi
[ ${#PICK[@]} -eq 0 ] && { echo "frontier is empty (all done or blocked)"; exit 0; }
git -C "$REPO_ROOT" fetch origin main --quiet || echo "warn: fetch failed, using local origin/main"
for NN in "${PICK[@]}"; do
  WT="$REPO_ROOT/../t$NN"
  if [ -d "$WT" ]; then
    echo "== T$NN  SKIP: worktree $WT already exists (in flight or stale)"
    continue
  fi
  PROMPT="$(perl -pe "s/\bNN\b/$NN/g" "$HERE/../PROMPT.md" | sed -n '/^---$/,$p' | tail -n +2)"
  echo "==> T$NN  (worktree ../t$NN, model $MODEL, fixture port $((4300 + 10#$NN)), service port $((8787 + 10#$NN)))"
  if [ "$DRY" = 1 ]; then continue; fi
  if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/t$NN"; then
    git -C "$REPO_ROOT" worktree add "$WT" "t$NN" >/dev/null
  else
    git -C "$REPO_ROOT" worktree add "$WT" -b "t$NN" origin/main >/dev/null
  fi
  (
    set -m  # own process group, so the agent survives this script being killed
    cd "$WT" && nohup opencode run "${AUTO_FLAG[@]}" --model "$MODEL" "$PROMPT" \
      < /dev/null > "$HERE/logs/T$NN.log" 2>&1 &
    echo "    pid $!  log $HERE/logs/T$NN.log"
  )
done
echo "Poll with: tail -f $HERE/logs/T*.log ; PRs with: gh pr list"
