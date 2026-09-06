# 26: Panel: edit + re-push

**What to build:** A user corrects a value in the field list and the form is updated through the same fill engine, with the status badge reflecting the result.

**Blocked by:** 25 (Desktop session wiring), 24 (Panel: PDF viewer with highlights)

**Status:** done

## Do exactly this
- `FieldRow`: click on value → inline `<input>` (or `<select>` for enum fields), Enter commits → `api.editField(fieldId, value)`, Escape cancels.
- `SessionController.editField`: dispatch `userEdit` (review→filling), build a single-step plan via `buildPlan` filtered to that `fieldId` (for grid cells: `fieldId` is `<groupId>[<row>].<colId>`; support that addressing in the planner filter), run the executor, then `fillComplete` (back to review).
- Badge after edit derives from the new events only (clear previous events for that field before re-run).

## Acceptance criteria
- [x] e2e: edit `dealAmount` to `2000000` → `#model.dealAmount` is `2000000` and the badge is `verified`.
- [x] Editing a grid cell `parties[0].amount` updates that cell only.
- [x] Escape leaves the value unchanged and dispatches nothing.
