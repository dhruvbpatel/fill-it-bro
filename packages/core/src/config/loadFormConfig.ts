import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { ExtractionConfig, FormConfig, LocatorSpec, WidgetProfiles } from '@fib/contracts';
import { ConfigError } from './ConfigError.js';

/** Everything the desktop app needs to drive one form, loaded and fully validated. */
export interface FormBundle {
  formId: string;
  urlTemplate: string;
  extraction: ExtractionConfig;
  form: FormConfig;
  profiles: WidgetProfiles;
  neverClick: LocatorSpec[];
}

/** Default guard rails merged ahead of any form-declared `neverClick` entries. */
const DEFAULT_NEVER_CLICK: LocatorSpec[] = [
  { role: { role: 'button', name: '/^(submit|save|delete)$/i' } },
];

const CONTRACTS_SCHEMAS_DIR = fileURLToPath(
  new URL('../../../contracts/schemas/', import.meta.url),
);

// Cross-file $refs (e.g. "locator-spec.schema.json") are plain relative filenames.
// $id is stripped before registering each schema under its filename key: Ajv would
// otherwise resolve those refs against the (non-fetchable) fib.local $id — same
// approach as packages/contracts/src/roundtrip.test.ts.
const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const entry of readdirSync(CONTRACTS_SCHEMAS_DIR)) {
  if (!entry.endsWith('.schema.json')) continue;
  const schema: Record<string, unknown> = JSON.parse(
    readFileSync(path.join(CONTRACTS_SCHEMAS_DIR, entry), 'utf-8'),
  );
  delete schema.$id;
  ajv.addSchema(schema, entry);
}

function validator(schemaFile: string, file: string): ValidateFunction {
  const validate = ajv.getSchema(schemaFile);
  if (!validate) throw new ConfigError(`contracts schema ${schemaFile} not found`, file, '');
  return validate as ValidateFunction;
}

function readJson(configsDir: string, relFile: string): unknown {
  let text: string;
  try {
    text = readFileSync(path.join(configsDir, relFile), 'utf-8');
  } catch {
    throw new ConfigError('file not found or unreadable', relFile, '');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`invalid JSON (${reason})`, relFile, '');
  }
}

function validateAgainst(schemaFile: string, data: unknown, file: string): void {
  const validate = validator(schemaFile, file);
  if (!validate(data)) {
    const first = validate.errors?.[0];
    const message = first?.message ?? 'failed schema validation';
    throw new ConfigError(`${schemaFile}: ${message}`, file, first?.instancePath ?? '');
  }
}

/**
 * Load `configs/forms/<formId>/{extraction,form,widget-profiles}.json` plus
 * `configs/templates.json`, validate each file against the `@fib/contracts`
 * schemas, run cross-file consistency checks, and return a `FormBundle`.
 * Throws {@link ConfigError} (with `file` and JSON pointer `path`) on the first
 * problem found.
 */
export function loadFormBundle(configsDir: string, formId: string): FormBundle {
  const extractionFile = `forms/${formId}/extraction.json`;
  const formFile = `forms/${formId}/form.json`;
  const profilesFile = `forms/${formId}/widget-profiles.json`;
  const templatesFile = 'templates.json';

  // --- schema validation -----------------------------------------------------
  const extraction = readJson(configsDir, extractionFile);
  validateAgainst('extraction-config.schema.json', extraction, extractionFile);

  const rawForm = readJson(configsDir, formFile);
  if (typeof rawForm !== 'object' || rawForm === null || Array.isArray(rawForm)) {
    throw new ConfigError('form config must be a JSON object', formFile, '');
  }
  // `neverClick` is optional in form.json but not part of the form-config schema
  // (which is closed); pull it out before validating and merge it in below.
  const rawRecord = rawForm as Record<string, unknown>;
  let configuredNeverClick: unknown[] = [];
  if ('neverClick' in rawRecord) {
    if (!Array.isArray(rawRecord.neverClick)) {
      throw new ConfigError(
        'neverClick must be an array of locator specs',
        formFile,
        '/neverClick',
      );
    }
    configuredNeverClick = rawRecord.neverClick;
  }
  delete rawRecord.neverClick;
  validateAgainst('form-config.schema.json', rawForm, formFile);
  const form = rawForm as FormConfig;

  const profiles = readJson(configsDir, profilesFile);
  validateAgainst('widget-profiles.schema.json', profiles, profilesFile);

  // --- url template (templates.json: formId -> { urlTemplate }) ----------------
  const templates = readJson(configsDir, templatesFile);
  if (typeof templates !== 'object' || templates === null || Array.isArray(templates)) {
    throw new ConfigError('must be an object mapping formId to urlTemplate', templatesFile, '');
  }
  if (!(formId in (templates as Record<string, unknown>))) {
    throw new ConfigError(`no url template for form "${formId}"`, templatesFile, `/${formId}`);
  }
  const entry = (templates as Record<string, unknown>)[formId];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new ConfigError(
      'template entry must be an object with a urlTemplate',
      templatesFile,
      `/${formId}`,
    );
  }
  const urlTemplate = (entry as Record<string, unknown>).urlTemplate;
  if (typeof urlTemplate !== 'string' || !urlTemplate.includes('{dealId}')) {
    throw new ConfigError(
      'urlTemplate must be a string containing "{dealId}"',
      templatesFile,
      `/${formId}/urlTemplate`,
    );
  }

  // --- cross-file consistency --------------------------------------------------
  const typedExtraction = extraction as ExtractionConfig;
  const typedProfiles = profiles as WidgetProfiles;

  const extractionFieldIds = new Set(typedExtraction.fields.map((f) => f.fieldId));
  const groupFieldIds = new Map<string, Set<string>>();
  for (const group of typedExtraction.groups) {
    groupFieldIds.set(group.groupId, new Set(group.fields.map((f) => f.fieldId)));
  }

  const formFieldIds = new Set<string>();
  const gridColumnFieldIds = new Map<string, Set<string>>();
  form.sections.forEach((section, si) => {
    section.fields.forEach((field, fi) => {
      formFieldIds.add(field.fieldId);
      if (Object.keys(field.locator).length === 0) {
        throw new ConfigError(
          `field "${field.fieldId}" has no locator keys`,
          formFile,
          `/sections/${si}/fields/${fi}/locator`,
        );
      }
      if (field.profile !== undefined && !(field.profile in typedProfiles)) {
        throw new ConfigError(
          `unknown profile "${field.profile}"`,
          formFile,
          `/sections/${si}/fields/${fi}/profile`,
        );
      }
      if (!extractionFieldIds.has(field.fieldId)) {
        throw new ConfigError(
          `field "${field.fieldId}" is not defined in extraction.json fields`,
          formFile,
          `/sections/${si}/fields/${fi}`,
        );
      }
    });
    section.grids.forEach((grid, gi) => {
      const columnIds = gridColumnFieldIds.get(grid.groupId) ?? new Set<string>();
      gridColumnFieldIds.set(grid.groupId, columnIds);
      grid.columns.forEach((column, ci) => {
        columnIds.add(column.fieldId);
        const groupFields = groupFieldIds.get(grid.groupId);
        if (!groupFields || !groupFields.has(column.fieldId)) {
          throw new ConfigError(
            `grid column "${column.fieldId}" is not a field of extraction group "${grid.groupId}"`,
            formFile,
            `/sections/${si}/grids/${gi}/columns/${ci}`,
          );
        }
      });
    });
  });

  typedExtraction.fields.forEach((field, i) => {
    if (!formFieldIds.has(field.fieldId)) {
      throw new ConfigError(
        `field "${field.fieldId}" is not present as a field in form.json`,
        extractionFile,
        `/fields/${i}`,
      );
    }
  });
  typedExtraction.groups.forEach((group, gi) => {
    group.fields.forEach((field, fi) => {
      if (!gridColumnFieldIds.get(group.groupId)?.has(field.fieldId)) {
        throw new ConfigError(
          `group field "${field.fieldId}" is not a column of grid "${group.groupId}" in form.json`,
          extractionFile,
          `/groups/${gi}/fields/${fi}`,
        );
      }
    });
  });

  // --- neverClick (defaults merged with form.json's optional entries) ----------
  configuredNeverClick.forEach((entry, i) => {
    const validate = validator('locator-spec.schema.json', formFile);
    if (!validate(entry)) {
      const first = validate.errors?.[0];
      throw new ConfigError(
        `invalid locator spec (${first?.message ?? 'failed schema validation'})`,
        formFile,
        `/neverClick/${i}${first?.instancePath ?? ''}`,
      );
    }
  });
  const neverClick: LocatorSpec[] = [
    ...DEFAULT_NEVER_CLICK,
    ...configuredNeverClick.map((entry) => entry as LocatorSpec),
  ];

  return {
    formId,
    urlTemplate,
    extraction: typedExtraction,
    form,
    profiles: typedProfiles,
    neverClick,
  };
}
