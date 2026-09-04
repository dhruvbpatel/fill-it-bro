# 29: Full e2e + docs

**What to build:** One command that runs the fixture form, the fake service mode, and the desktop app end to end in CI, plus documentation that lets a developer add a new form or widget adapter without reading the code.

**Blocked by:** 26 (Panel: edit + re-push), 27 (Eval harness + synthetic goldens), 28 (Portable EXE packaging + deploy jobs)

**Status:** ready-for-agent

## Do exactly this
- Root `pnpm e2e`: Playwright config with `webServer` for the fixture (4300); spec `e2e/full-loop.spec.ts` = ticket 25's flow + ticket 26's edit + open citation viewer and assert a highlight div exists on the expected page; run on Linux in CI (`xvfb-run` for Electron).
- `README.md` per package and app (purpose, public API, how to test) and root `README.md` (architecture diagram from PLAN §2, quick start).
- `CONTRIBUTING.md` walkthroughs: "Add a form" (create `configs/forms/<id>/`, write extraction fields and prompts, write `form.json` sections, `pnpm validate-configs`, add a golden case) and "Add a widget adapter" (implement `WidgetAdapter`, register, add a profile, write a fixture test).
- Delete placeholder scripts left by ticket 01.

## Acceptance criteria
- [ ] `pnpm e2e` green locally and in CI.
- [ ] Every package has a README with a working test command.
- [ ] Following "Add a form" verbatim on a copy of `fixtureDeal` under a new id passes `pnpm validate-configs`.
