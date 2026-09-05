import type { FillPlan, FillStep, ResolvedField, Section } from '@fib/contracts';
import { ConfigError } from '../config/ConfigError.js';
import type { FormBundle } from '../config/loadFormConfig.js';

/** Resolved counterpart of `ExtractionResult.groups`; cells carry resolved values. */
export interface ResolvedGroup {
  groupId: string;
  rows: { cells: ResolvedField[] }[];
}

/**
 * Contract `FillStep` plus the fields the executor needs that the wire schema
 * does not carry (control/profile/valueType) and the noValue skip marker.
 * `PlanStep[]` remains assignable to the contract's `FillStep[]`.
 */
export interface PlanStep extends FillStep {
  control?: string;
  profile?: string;
  valueType?: string;
  skip?: boolean;
  reason?: string;
}

export interface BuildPlanOpts {
  /** Existing rows per groupId; defaults to 0 (every extracted row needs addRow). */
  gridRowCounts?: Record<string, number>;
}

export function buildPlan(
  bundle: FormBundle,
  fields: ResolvedField[],
  groups: ResolvedGroup[],
  opts: BuildPlanOpts = {},
): FillPlan {
  const formFile = `forms/${bundle.formId}/form.json`;
  const byFieldId = new Map(fields.map((field) => [field.fieldId, field]));
  const rowsByGroupId = new Map(groups.map((group) => [group.groupId, group.rows]));

  const steps: PlanStep[] = [];
  const nextStepId = (() => {
    let n = 0;
    return () => `s${n++}`;
  })();

  bundle.form.sections.forEach((section, si) => {
    if (section.tab) {
      steps.push({
        stepId: nextStepId(),
        kind: 'navigateTab',
        sectionId: section.id,
        locator: section.tab.locator,
      });
    }
    for (const action of section.reveal ?? []) {
      steps.push({
        stepId: nextStepId(),
        kind: 'reveal',
        sectionId: section.id,
        locator: action.locator,
      });
    }

    for (const field of orderFields(section, si, formFile)) {
      const resolved = byFieldId.get(field.fieldId);
      if (resolved === undefined || resolved.value === null || resolved.value === undefined) {
        steps.push({
          stepId: nextStepId(),
          kind: 'fillField',
          sectionId: section.id,
          fieldId: field.fieldId,
          skip: true,
          reason: 'noValue',
        });
      } else {
        steps.push({
          stepId: nextStepId(),
          kind: 'fillField',
          sectionId: section.id,
          fieldId: field.fieldId,
          control: field.control,
          locator: field.locator,
          ...(field.profile !== undefined ? { profile: field.profile } : {}),
          value: String(resolved.value),
          valueType: resolved.valueType,
        });
      }
    }

    section.grids.forEach((grid, gi) => {
      const rows = rowsByGroupId.get(grid.groupId) ?? [];
      const existingRows = opts.gridRowCounts?.[grid.groupId] ?? 0;
      rows.forEach((row, rowIndex) => {
        if (rowIndex >= existingRows) {
          if (!grid.addRow) {
            throw new ConfigError(
              `grid "${grid.groupId}" needs row ${rowIndex + 1} but declares no addRow locator`,
              formFile,
              `/sections/${si}/grids/${gi}/addRow`,
            );
          }
          steps.push({
            stepId: nextStepId(),
            kind: 'addRow',
            sectionId: section.id,
            groupId: grid.groupId,
            rowIndex,
            locator: grid.addRow.locator,
          });
        }
        for (const column of grid.columns) {
          const cell = row.cells.find((candidate) => candidate.fieldId === column.fieldId);
          if (cell === undefined || cell.value === null || cell.value === undefined) continue;
          steps.push({
            stepId: nextStepId(),
            kind: 'fillCell',
            sectionId: section.id,
            groupId: grid.groupId,
            rowIndex,
            colId: column.colId,
            control: column.control,
            value: String(cell.value),
          });
        }
      });
    });
  });

  return { steps };
}

/** Stable topological order of a section's fields by their in-section `dependsOn`. */
function orderFields(section: Section, si: number, formFile: string): Section['fields'] {
  const byId = new Map(section.fields.map((field) => [field.fieldId, field]));

  const dependenciesOf = (field: Section['fields'][number]): Section['fields'] => {
    return (field.dependsOn ?? []).map((depId) => {
      const dep = byId.get(depId);
      if (!dep) {
        throw new ConfigError(
          `field "${field.fieldId}" dependsOn unknown field "${depId}"`,
          formFile,
          `/sections/${si}/fields/${section.fields.indexOf(field)}/dependsOn`,
        );
      }
      return dep;
    });
  };

  const emitted = new Set<string>();
  const remaining = [...section.fields];
  const ordered: Section['fields'] = [];
  while (remaining.length > 0) {
    const ready = remaining.findIndex((field) =>
      dependenciesOf(field).every((dep) => emitted.has(dep.fieldId)),
    );
    if (ready === -1) {
      const cycle = remaining.map((field) => field.fieldId).join('", "');
      throw new ConfigError(
        `circular dependsOn between fields "${cycle}"`,
        formFile,
        `/sections/${si}/fields`,
      );
    }
    const [field] = remaining.splice(ready, 1);
    emitted.add(field.fieldId);
    ordered.push(field);
  }
  return ordered;
}
