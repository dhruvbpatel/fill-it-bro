# Task 1: searchSelect panel hygiene (fill stall fix)

## Problem (evidence: runs.jsonl run 7c36c061, apps/fixture-form)
After the searchSelect adapter picks an option, the fixture form's wrapping <label>
forwards the option-click to the trigger button, REOPENING the dropdown panel.
The open panel overlays the next field (dealAmount input): every click on it is
intercepted -> 3 x 30s Playwright click timeouts -> 20s fallback budget -> step failed.
Remaining fields then fill instantly ("sprint"). ~113s stall on one field.

The adapter's error paths "dismiss" via Escape, but the widget has no Escape handler,
so that dismiss is a no-op. The widget only closes via: selecting an option, or
clicking the trigger again (togglePanel).

## Requirements
1. In packages/adapters/src/searchSelect.ts, after a successful pick
   (after waitFor selectedValue visible), ensure the panel is closed: if
   optionList is still visible/attached (count > 0), click the trigger again to
   toggle it closed. Tolerate failures to close on the success path (log via
   ctx.log, do not throw) — the pick already succeeded and verify will read
   selectedValue.
2. On error paths (OptionsNotSettled throw path and NoMatchingOption throw path),
   replace the no-op Escape dismiss with the same trigger-click-to-close
   attempt (also best-effort: original error must still propagate; wrap the
   close attempt in try/catch that swallows only the close error).
3. Keep the profile-based structure (locators resolve within target); do not
   add new profile keys. Do not modify the fixture form component.
4. Tests in packages/adapters/src/searchSelect.test.ts:
   - after a successful pick, the trigger is clicked a second time when the
     panel would still be open (model the fake driver so optionList count
     stays > 0 until the trigger is clicked again).
   - on NoMatchingOption, the trigger close attempt is made and the
     NoMatchingOption error still propagates.
   - existing tests keep passing (adjust fakes minimally if their shape
     requires it, preserving what they assert).
5. TDD: write the failing tests first (RED), then implement (GREEN). Record
   commands + outputs in the report.

## Verify
- pnpm --filter @fib/adapters exec vitest run  (panel of adapters unit tests)
- pnpm --filter @fib/adapters test  (adds its playwright suite)
