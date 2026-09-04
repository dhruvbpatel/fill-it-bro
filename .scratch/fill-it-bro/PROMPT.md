# Ticket runner prompt

Paste this as the first message of a new Conductor workspace (or a Claude Code session), replacing `NN`.

---

Implement ticket NN from `.scratch/fill-it-bro/issues/` in this repository.

Rules:
1. Read `.scratch/fill-it-bro/PLAN.md` section 15 ("Global conventions" and "Key interfaces") first, then the ticket file. Interfaces are final. Do not rename, redesign, or add scope.
2. Do only what the ticket's "Do exactly this" says. If something is genuinely ambiguous, pick the simplest option that satisfies the acceptance criteria and note it in the PR description.
3. Ports: the fixture form listens on `FIXTURE_PORT` (default 4300) and the service on `PORT` (default 8787). Read them from the environment in any script or test you write.
4. Write the tests named in the ticket. Run the package's test command and `pnpm lint` (and `uv run pytest` for Python) until green. Paste the final passing output in the PR description.
5. Tick every acceptance criterion in the ticket file, change its `**Status:**` line to `done`, and commit with the ticket number in the subject, e.g. `T07: service /extract`.
6. Open a PR against `main` titled `T NN: <ticket title>` with body: what was built, how it was verified, anything left unclear.
7. Do not touch files outside your ticket's packages except: `packages/contracts` when the ticket says to add a schema and regen, and root scripts when the ticket says so.
