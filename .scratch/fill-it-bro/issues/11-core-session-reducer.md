# 11: Core: session reducer

**What to build:** A pure state machine for one fill session that every host (Electron now, others later) drives, with illegal transitions rejected.

**Blocked by:** 02 (Contracts + codegen)

**Status:** done

## Do exactly this
- `packages/core/src/session.ts` implementing exactly the `SessionState`, `SessionEvent`, `reduce` from PLAN §15. `SessionSnapshot = { state, dealId?, formId?, documentSet?, extraction?, fields: ResolvedField[], fillEvents: FillEvent[], error? }`.
- Legal edges: idle→launching(launch); launching→formReady(formReady); formReady→ingesting(filesDropped); ingesting→extracting(ingested); extracting→resolving(extracted); resolving→filling(resolved); filling→filling(fillEvent, appends); filling→review(fillComplete); review→filling(userEdit); review→done (add event `{type:'finish'}`); any→failed(fail). Everything else throws `IllegalTransition(state, event.type)`.
- `userEdit` updates the matching field's `value` and sets its `status` to `found` before transitioning.
- Export `initialSnapshot()`.

## Acceptance criteria
- [x] Table-driven test covering every legal edge above.
- [x] Three illegal transitions throw `IllegalTransition` with state and event in the message.
- [x] `reduce` never mutates its input (test with frozen objects).
