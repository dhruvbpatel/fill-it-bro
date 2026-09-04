# 01: Monorepo scaffold

**What to build:** A repository where every package and app from the plan exists, builds, lints and tests (empty), with one CI workflow that runs path-filtered jobs. Nothing functional yet; every later ticket adds to this skeleton.

**Blocked by:** None (can start immediately)

**Status:** done (254720a)

## Read first
- `.scratch/fill-it-bro/PLAN.md` §3 (layout) and §15 "Global conventions".

## Do exactly this
- Root: `package.json` (private, `packageManager: pnpm@9`), `pnpm-workspace.yaml` with `packages/*` and `apps/*`, `tsconfig.base.json` (strict, ESM, `moduleResolution: bundler`), `.editorconfig`, `.prettierrc`, `eslint.config.js` using typescript-eslint with `@typescript-eslint/no-explicit-any: error`, `.gitignore` (node_modules, dist, .venv, `*.log`, `.scratch/**/tmp`).
- Root scripts: `build` (`pnpm -r build`), `test` (`pnpm -r test`), `lint` (eslint + prettier check + `ruff check`), `contracts:gen`, `validate-configs`, `fixture:serve`, `e2e` (placeholders that exit 0 until later tickets implement them).
- TS packages, each with `package.json`, `tsconfig.json`, `src/index.ts`, one passing Vitest test: `packages/contracts` (`@fib/contracts`), `packages/core` (`@fib/core`), `packages/driver-playwright` (`@fib/driver-playwright`), `packages/adapters` (`@fib/adapters`), `packages/fill-engine` (`@fib/fill-engine`), `packages/ingest` (`@fib/ingest`), `packages/panel` (`@fib/panel`, Vite + React 18), `packages/api-client` (`@fib/api-client`).
- Apps: `apps/desktop` (Electron, current stable, `electron-vite`), `apps/fixture-form` (placeholder folder with README; Angular scaffold is ticket 14), `apps/service` (Python).
- Python: root `pyproject.toml` with `[tool.uv.workspace] members = ["apps/service", "evals/harness"]`; `apps/service/pyproject.toml` (package `fib_service`, deps fastapi, uvicorn, pydantic>=2, openai, httpx; dev pytest, ruff), `evals/harness/pyproject.toml` (package `fib_evals`). One passing pytest in each.
- `configs/` with `templates.json` = `{ "fixtureDeal": { "urlTemplate": "http://localhost:4300/deal/{dealId}" } }` and empty `configs/forms/fixtureDeal/` folder with `.gitkeep`.
- `.github/workflows/ci.yml`: jobs `ts` (pnpm install, build, lint, test), `py` (uv sync, ruff, pytest), `fixture` (placeholder echo until ticket 14). Use `dorny/paths-filter` to skip jobs whose paths did not change.

## Acceptance criteria
- [x] `pnpm install && pnpm build && pnpm lint && pnpm test` exit 0 from a clean clone.
- [x] `uv sync && uv run pytest` exit 0.
- [x] CI workflow file is valid and runs the three jobs.
- [x] Every package name matches the plan exactly.
