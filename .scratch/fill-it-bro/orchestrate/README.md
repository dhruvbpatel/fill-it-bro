
## Rate-limit behavior (2026-09-05)
Provider (zai-coding-plan) rate limits kill wave agents mid-run; even throttled
relaunches can re-hit it. Protocol:
- Prefer ≤4 concurrent agents per wave; stagger launches ~45s.
- On "Rate limit reached" in a TNN.log: wait 5 min, relaunch in the same worktree
  (partial work is kept). Use `run-ticket.sh NN` — it does the sweep/cooldown/retry
  loop automatically (env: MAX_ATTEMPTS, RATE_LIMIT_COOLDOWN).
- Kill hung `opencode run` leftovers before reusing a worktree (check cwd via lsof).
