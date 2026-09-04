import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormConfig, WidgetProfiles } from '@fib/contracts';
import { ConfigError } from './ConfigError.js';
import { loadFormBundle } from './loadFormConfig.js';

const REPO_CONFIGS = fileURLToPath(new URL('../../../../configs', import.meta.url));

const FORM_ID = 'fixtureDeal';

function baseExtraction(): object {
  return {
    formId: FORM_ID,
    fields: [
      {
        fieldId: 'issuerName',
        type: 'string',
        description: 'The legal name of the issuing entity.',
        required: true,
        examples: ['Goldman Sachs Incorporated'],
      },
      {
        fieldId: 'dealAmount',
        type: 'number',
        description: 'The principal amount of the deal.',
        required: true,
        examples: ['1500000'],
      },
    ],
    groups: [
      {
        groupId: 'parties',
        description: 'Each party involved in the deal.',
        fields: [
          {
            fieldId: 'partyName',
            type: 'string',
            description: 'The legal name of the party.',
            required: true,
            examples: ['Goldman Sachs Incorporated'],
          },
        ],
      },
    ],
  };
}

function baseForm(): FormConfig {
  return {
    formId: FORM_ID,
    urlTemplate: 'http://localhost:4300/deal/{dealId}',
    widgetProfiles: './widget-profiles.json',
    sections: [
      {
        id: 'deal',
        tab: { locator: { role: { name: 'Deal', role: 'tab' } } },
        reveal: [{ action: 'click', locator: { role: { name: 'Add fees', role: 'button' } } }],
        fields: [
          {
            fieldId: 'issuerName',
            control: 'searchSelect',
            locator: { formControlName: 'issuerName' },
            profile: 'fixtureSearchSelect',
          },
          {
            fieldId: 'dealAmount',
            control: 'text',
            locator: { formControlName: 'dealAmount' },
          },
        ],
        grids: [],
      },
      {
        id: 'parties',
        tab: { locator: { role: { name: 'Parties', role: 'tab' } } },
        fields: [],
        grids: [
          {
            groupId: 'parties',
            control: 'agGrid',
            locator: { css: '[data-testid="parties-grid"]' },
            addRow: { locator: { role: { name: 'Add row', role: 'button' } } },
            columns: [{ fieldId: 'partyName', colId: 'partyName', control: 'text' }],
          },
        ],
      },
    ],
  };
}

function baseProfiles(): WidgetProfiles {
  return {
    fixtureSearchSelect: {
      trigger: { css: '.fib-select__trigger' },
      searchInput: { css: '.fib-select__search' },
      optionList: { css: '.fib-select__options' },
      optionItem: { css: '.fib-select__option' },
      loadingIndicator: { css: '.fib-select__loading' },
      selectedValue: { css: '.fib-select__value' },
      settleMs: 300,
      maxWaitMs: 5000,
    },
  };
}

function baseTemplates(): object {
  return { fixtureDeal: { urlTemplate: 'http://localhost:4300/deal/{dealId}' } };
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

/** Writes a complete configs dir from overrides and returns its path. */
function writeConfigs(overrides: {
  extraction?: object;
  form?: object;
  profiles?: object;
  templates?: object;
}): string {
  const configsDir = mkdtempSync(path.join(tmpdir(), 'fib-core-config-'));
  tempDirs.push(configsDir);
  const formDir = path.join(configsDir, 'forms', FORM_ID);
  mkdirSync(formDir, { recursive: true });
  const files: Record<string, object> = {
    [path.join('forms', FORM_ID, 'extraction.json')]: overrides.extraction ?? baseExtraction(),
    [path.join('forms', FORM_ID, 'form.json')]: overrides.form ?? baseForm(),
    [path.join('forms', FORM_ID, 'widget-profiles.json')]: overrides.profiles ?? baseProfiles(),
    'templates.json': overrides.templates ?? baseTemplates(),
  };
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(configsDir, rel), `${JSON.stringify(content, null, 2)}\n`);
  }
  return configsDir;
}

function loadError(configsDir: string): ConfigError {
  try {
    loadFormBundle(configsDir, FORM_ID);
  } catch (err) {
    if (!(err instanceof ConfigError)) {
      throw new Error(`expected ConfigError, got: ${String(err)}`, { cause: err });
    }
    return err;
  }
  throw new Error('expected loadFormBundle to throw, but it resolved');
}

describe('loadFormBundle on the shipped fixtureDeal configs', () => {
  it('loads and returns the full bundle', () => {
    const bundle = loadFormBundle(REPO_CONFIGS, FORM_ID);
    expect(bundle.formId).toBe(FORM_ID);
    expect(bundle.urlTemplate).toBe('http://localhost:4300/deal/{dealId}');
    expect(bundle.extraction.fields.map((f) => f.fieldId)).toEqual([
      'issuerName',
      'dealAmount',
      'currency',
      'settlementDate',
      'isConfidential',
      'feeType',
    ]);
    expect(bundle.extraction.groups[0]?.groupId).toBe('parties');
    expect(bundle.form.sections.map((s) => s.id)).toEqual(['deal', 'parties']);
    expect(bundle.profiles.fixtureSearchSelect?.settleMs).toBe(300);
  });

  it('applies the default neverClick when form.json omits it', () => {
    const bundle = loadFormBundle(REPO_CONFIGS, FORM_ID);
    expect(bundle.neverClick).toEqual([
      { role: { role: 'button', name: '/^(submit|save|delete)$/i' } },
    ]);
  });
});

describe('loadFormBundle cross checks', () => {
  it('fails when form.json has a field missing from extraction.json', () => {
    const form = baseForm();
    form.sections[0]!.fields.push({
      fieldId: 'mysteryField',
      control: 'text',
      locator: { formControlName: 'mysteryField' },
    });
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/0/fields/2');
    expect(err.message).toContain('mysteryField');
  });

  it('fails when extraction.json has a field missing from form.json', () => {
    const extraction = baseExtraction() as { fields: object[] };
    extraction.fields.push({
      fieldId: 'orphanField',
      type: 'string',
      description: 'Nowhere to be filled.',
      required: false,
      examples: [],
    });
    const err = loadError(writeConfigs({ extraction }));
    expect(err.file).toBe(`forms/${FORM_ID}/extraction.json`);
    expect(err.path).toBe('/fields/2');
    expect(err.message).toContain('orphanField');
  });

  it('fails when a grid column is missing from the matching extraction group', () => {
    const form = baseForm();
    form.sections[1]!.grids[0]!.columns.push({
      fieldId: 'partyRole',
      colId: 'partyRole',
      control: 'select',
    });
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/1/grids/0/columns/1');
    expect(err.message).toContain('partyRole');
  });

  it('fails when an extraction group field is missing from the form grid', () => {
    const extraction = baseExtraction() as { groups: { fields: object[] }[] };
    extraction.groups[0]!.fields.push({
      fieldId: 'partyAmount',
      type: 'number',
      description: 'The amount for the party.',
      required: false,
      examples: ['250000'],
    });
    const err = loadError(writeConfigs({ extraction }));
    expect(err.file).toBe(`forms/${FORM_ID}/extraction.json`);
    expect(err.path).toBe('/groups/0/fields/1');
    expect(err.message).toContain('partyAmount');
  });

  it('fails on an unknown widget profile reference', () => {
    const form = baseForm();
    form.sections[0]!.fields[0]!.profile = 'nonexistentProfile';
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/0/fields/0/profile');
    expect(err.message).toContain('nonexistentProfile');
  });

  it('fails when a field locator has no keys', () => {
    const form = baseForm();
    form.sections[0]!.fields[1]!.locator = {};
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/0/fields/1/locator');
    expect(err.message).toContain('dealAmount');
  });

  it('fails when a url template lacks {dealId}', () => {
    const err = loadError(
      writeConfigs({ templates: { fixtureDeal: { urlTemplate: 'http://localhost:4300/deal/1' } } }),
    );
    expect(err.file).toBe('templates.json');
    expect(err.path).toBe(`/${FORM_ID}/urlTemplate`);
  });

  it('fails when templates.json has no entry for the form', () => {
    const err = loadError(writeConfigs({ templates: {} }));
    expect(err.file).toBe('templates.json');
    expect(err.path).toBe(`/${FORM_ID}`);
  });
});

describe('loadFormBundle schema validation', () => {
  it('fails on a bad enum value with the schema error location', () => {
    const form = baseForm() as unknown as {
      sections: { fields: { control: string }[] }[];
    };
    form.sections[0]!.fields[1]!.control = 'textbox';
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/0/fields/1/control');
    expect(err.message).toContain('allowed values');
  });

  it('fails on a field with an unknown property', () => {
    const form = baseForm() as unknown as { sections: { fields: object[] }[] };
    form.sections[0]!.fields[1] = { ...form.sections[0]!.fields[1]!, oops: true };
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/sections/0/fields/1');
    expect(err.message).toContain('additional');
  });

  it('fails on malformed JSON with the offending file', () => {
    const configsDir = writeConfigs({});
    writeFileSync(path.join(configsDir, `forms/${FORM_ID}`, 'extraction.json'), '{ not json');
    const err = loadError(configsDir);
    expect(err.file).toBe(`forms/${FORM_ID}/extraction.json`);
  });

  it('fails when a config file is missing', () => {
    const configsDir = writeConfigs({});
    rmSync(path.join(configsDir, `forms/${FORM_ID}`, 'widget-profiles.json'));
    const err = loadError(configsDir);
    expect(err.file).toBe(`forms/${FORM_ID}/widget-profiles.json`);
  });
});

describe('neverClick merging', () => {
  it('merges defaults with form.json neverClick entries', () => {
    const form = baseForm() as unknown as Record<string, unknown>;
    form.neverClick = [{ css: '.really-dangerous' }];
    const bundle = loadFormBundle(writeConfigs({ form }), FORM_ID);
    expect(bundle.neverClick).toEqual([
      { role: { role: 'button', name: '/^(submit|save|delete)$/i' } },
      { css: '.really-dangerous' },
    ]);
  });

  it('rejects a neverClick entry that is not a locator spec', () => {
    const form = baseForm() as unknown as Record<string, unknown>;
    form.neverClick = [{ nth: 'first' }];
    const err = loadError(writeConfigs({ form }));
    expect(err.file).toBe(`forms/${FORM_ID}/form.json`);
    expect(err.path).toBe('/neverClick/0/nth');
  });
});
