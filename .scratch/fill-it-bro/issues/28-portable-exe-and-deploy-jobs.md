# 28: Portable EXE packaging + deploy jobs

**What to build:** A single portable Windows EXE, with configs bundled, that launches from a shared drive with a deal id, plus CI jobs that build the EXE artifact and the service container image.

**Blocked by:** 25 (Desktop session wiring)

**Status:** done

## Do exactly this
- `apps/desktop/electron-builder.yml`: `win.target: portable`, `artifactName: fill-it-bro-${version}.exe`, `extraResources: [{ from: ../../configs, to: configs }]`, `asarUnpack` for the LiteParse native module (if ticket 03 chose native; rebuild with `@electron/rebuild` in `postinstall`), `files` excluding tests and fixtures.
- Configs resolve from `process.resourcesPath/configs` (ticket 21 already branches on `app.isPackaged`).
- Playwright: depend on `playwright-core` only (no browser download) since the driver connects over CDP.
- CI `build-exe` job on `windows-latest`: `pnpm install`, `pnpm build`, `pnpm --filter desktop package`, upload artifact; smoke: start the EXE with `--dealId=1 --formId=fixtureDeal --smoke` where `--smoke` makes main print the CDP URL and exit 0 after `/json/version` responds.
- CI `deploy-service` job: `apps/service/Dockerfile` (python 3.12-slim, uv sync --frozen, `uvicorn fib_service.main:app --host 0.0.0.0 --port 8787`), build and push to `${{ vars.REGISTRY }}` on `main` only.

## Acceptance criteria
- [x] EXE artifact produced on a Windows runner and the `--smoke` launch exits 0.
- [x] Artifact contains `resources/configs/forms/fixtureDeal/form.json`.
- [x] Service image builds and `/healthz` responds inside the container.
