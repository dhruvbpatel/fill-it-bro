#!/usr/bin/env bash
# Launch one headless Claude Code agent per frontier ticket, each in its own git worktree.
# Usage: ./dispatch-claude.sh [--model sonnet|haiku|opus] [--dry-run] [NN ...]
# Run from the repository root on an up-to-date main. Logs land in .scratch/fill-it-bro/orchestrate/logs/.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL="sonnet"; DRY=0; PICK=()
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    *) PICK+=("$1"); shift;;
  esac
done
mkdir -p "$HERE/logs"
if [ ${#PICK[@]} -eq 0 ]; then
  while IFS= read -r n; do [ -n "$n" ] && PICK+=("$n"); done < <("$HERE/frontier.py" --json | python3 -c 'import json,sys;[print(t["num"]) for t in json.load(sys.stdin)]')
fi
[ ${#PICK[@]} -eq 0 ] && { echo "frontier is empty (all done or blocked)"; exit 0; }
for NN in "${PICK[@]}"; do
  PROMPT="$(sed "s/\bNN\b/$NN/g" "$HERE/../PROMPT.md" | sed -n '/^---$/,$p' | tail -n +2)"
  echo "==> T$NN  (worktree t$NN, model $MODEL)"
  if [ "$DRY" = 1 ]; then continue; fi
  nohup claude -p --worktree "t$NN" --model "$MODEL" --permission-mode acceptEdits \
    --output-format text "$PROMPT" > "$HERE/logs/T$NN.log" 2>&1 &
  echo "    pid $!  log $HERE/logs/T$NN.log"
done
echo "Poll with: tail -f $HERE/logs/T*.log ; PRs with: gh pr list"
