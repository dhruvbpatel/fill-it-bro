import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ExtractionConfig, ResolvedField, Section } from '@fib/contracts';
import { ConfigError } from '../config/ConfigError.js';
import { loadFormBundle, type FormBundle } from '../config/loadFormConfig.js';
import { buildPlan, type ResolvedGroup } from './buildPlan.js';

const REPO_CONFIGS = fileURLToPath(new URL('../../../../configs', import.meta.url));

function resolved(
  fieldId: string,
  value: string | number | boolean | null,
  valueType = 'string',
): ResolvedField {
  return {
    fieldId,
    value,
    valueType,
    status: value === null ? 'notFound' : 'found',
    confidence: 0.9,
    sourceId: 'src1',
    reason: null,
    citations: [],
  };
}

function bundleWith(sections: Section[]): FormBundle {
  const extraction: ExtractionConfig = { formId: 'testForm', fields: [], groups: [] };
  return {
    formId: 'testForm',
    urlTemplate: 'http://localhost:4300/deal/{dealId}',
    extraction,
    form: {
      formId: 'testForm',
      urlTemplate: 'http://localhost:4300/deal/{dealId}',
      widgetProfiles: './widget-profiles.json',
      sections,
    },
    profiles: {},
    neverClick: [],
  };
}

function textField(fieldId: string, dependsOn?: string[]): Section['fields'][number] {
  return {
    fieldId,
    control: 'text',
    locator: { formControlName: fieldId },
    ...(dependsOn !== undefined ? { dependsOn } : {}),
  };
}

describe('buildPlan on the shipped fixtureDeal bundle', () => {
  it('snapshots the full plan with 2 party rows and gridRowCounts.parties = 1', () => {
    const bundle = loadFormBundle(REPO_CONFIGS, 'fixtureDeal');
    const fields: ResolvedField[] = [
      resolved('issuerName', 'Goldman Sachs Incorporated'),
      resolved('dealAmount', 1500000, 'number'),
      resolved('currency', 'USD'),
      resolved('settlementDate', null, 'date'),
      resolved('isConfidential', false, 'boolean'),
      resolved('feeType', null),
    ];
    const groups: ResolvedGroup[] = [
      {
        groupId: 'parties',
        rows: [
          {
            cells: [
              resolved('partyName', 'Goldman Sachs Incorporated'),
              resolved('role', 'Issuer'),
              resolved('amount', null, 'number'),
            ],
          },
          {
            cells: [
              resolved('partyName', 'Morgan Stanley & Co. LLC'),
              resolved('role', 'Agent'),
              resolved('amount', 250000, 'number'),
            ],
          },
        ],
      },
    ];

    const plan = buildPlan(bundle, fields, groups, { gridRowCounts: { parties: 1 } });

    const addRows = plan.steps.filter((step) => step.kind === 'addRow');
    expect(addRows).toHaveLength(1);
    expect(addRows[0]?.rowIndex).toBe(1);
    expect(addRows[0]?.groupId).toBe('parties');
    expect(plan).toMatchSnapshot();
  });

  it('emits navigateTab, reveal, skip markers, and typed fillField steps in order', () => {
    const bundle = loadFormBundle(REPO_CONFIGS, 'fixtureDeal');
    const plan = buildPlan(
      bundle,
      [
        resolved('issuerName', 'Goldman Sachs Incorporated'),
        resolved('dealAmount', 1500000, 'number'),
        resolved('currency', 'USD'),
        resolved('settlementDate', null, 'date'),
        resolved('isConfidential', false, 'boolean'),
        resolved('feeType', null),
      ],
      [],
    );

    const dealSteps = plan.steps.filter((step) => step.sectionId === 'deal');
    expect(dealSteps.map((step) => step.kind)).toEqual([
      'navigateTab',
      'reveal',
      'fillField',
      'fillField',
      'fillField',
      'fillField',
      'fillField',
      'fillField',
    ]);
    expect(dealSteps[0]?.locator).toEqual({ role: { name: 'Deal', role: 'tab' } });
    expect(dealSteps[1]?.locator).toEqual({ role: { name: 'Add fees', role: 'button' } });
    expect(dealSteps[2]).toMatchObject({
      kind: 'fillField',
      fieldId: 'issuerName',
      control: 'searchSelect',
      profile: 'fixtureSearchSelect',
      locator: { formControlName: 'issuerName' },
      value: 'Goldman Sachs Incorporated',
      valueType: 'string',
    });
    expect(dealSteps[3]).toMatchObject({
      fieldId: 'dealAmount',
      control: 'text',
      value: '1500000',
      valueType: 'number',
    });
    expect(dealSteps[6]).toMatchObject({
      fieldId: 'isConfidential',
      control: 'checkbox',
      value: 'false',
      valueType: 'boolean',
    });
    expect(dealSteps[5]).toMatchObject({
      fieldId: 'settlementDate',
      skip: true,
      reason: 'noValue',
    });
    expect(dealSteps[7]).toMatchObject({ fieldId: 'feeType', skip: true, reason: 'noValue' });
    expect(plan.steps.filter((step) => step.sectionId === 'parties').map((s) => s.kind)).toEqual([
      'navigateTab',
    ]);
  });
});

describe('buildPlan grids', () => {
  const gridSection: Section = {
    id: 'parties',
    fields: [],
    grids: [
      {
        groupId: 'parties',
        control: 'agGrid',
        locator: { css: '[data-testid="parties-grid"]' },
        addRow: { locator: { role: { name: 'Add row', role: 'button' } } },
        columns: [
          { fieldId: 'partyName', colId: 'partyName', control: 'text' },
          { fieldId: 'amount', colId: 'amount', control: 'text' },
        ],
      },
    ],
  };

  const twoRows: ResolvedGroup[] = [
    {
      groupId: 'parties',
      rows: [
        {
          cells: [
            resolved('partyName', 'Goldman Sachs Incorporated'),
            resolved('amount', null, 'number'),
          ],
        },
        {
          cells: [
            resolved('partyName', 'Morgan Stanley & Co. LLC'),
            resolved('amount', 250000, 'number'),
          ],
        },
      ],
    },
  ];

  it('defaults existing rows to 0 and adds a row for each extracted row', () => {
    const plan = buildPlan(bundleWith([gridSection]), [], twoRows);
    const addRows = plan.steps.filter((step) => step.kind === 'addRow');
    expect(addRows.map((step) => step.rowIndex)).toEqual([0, 1]);
  });

  it('only emits fillCell steps for non-null cells', () => {
    const plan = buildPlan(bundleWith([gridSection]), [], twoRows, {
      gridRowCounts: { parties: 2 },
    });
    const cells = plan.steps.filter((step) => step.kind === 'fillCell');
    expect(cells.map((step) => `${step.rowIndex}:${step.colId}`)).toEqual([
      '0:partyName',
      '1:partyName',
      '1:amount',
    ]);
    expect(cells[0]).toMatchObject({
      kind: 'fillCell',
      groupId: 'parties',
      control: 'text',
      value: 'Goldman Sachs Incorporated',
    });
  });

  it('throws ConfigError when rows must be added but the grid has no addRow locator', () => {
    const noAddRow: Section = {
      ...gridSection,
      grids: [{ ...gridSection.grids[0]!, addRow: undefined }],
    };
    expect(() => buildPlan(bundleWith([noAddRow]), [], twoRows)).toThrow(ConfigError);
  });
});

describe('buildPlan dependsOn ordering', () => {
  const section: Section = {
    id: 'deal',
    fields: [textField('b', ['a']), textField('a'), textField('c', ['b']), textField('d')],
    grids: [],
  };

  it('emits a field after every in-section field it depends on', () => {
    const plan = buildPlan(
      bundleWith([section]),
      [resolved('a', '1'), resolved('b', '2'), resolved('c', '3'), resolved('d', '4')],
      [],
    );
    expect(
      plan.steps.filter((step) => step.kind === 'fillField').map((step) => step.fieldId),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('throws ConfigError on a dependsOn cycle', () => {
    const cyclic: Section = {
      id: 'deal',
      fields: [textField('a', ['b']), textField('b', ['a'])],
      grids: [],
    };
    expect(() => buildPlan(bundleWith([cyclic]), [], [])).toThrow(ConfigError);
    expect(() => buildPlan(bundleWith([cyclic]), [], [])).toThrow(/circular dependsOn/);
  });

  it('throws ConfigError on a self dependency', () => {
    const selfDep: Section = {
      id: 'deal',
      fields: [textField('a', ['a'])],
      grids: [],
    };
    expect(() => buildPlan(bundleWith([selfDep]), [], [])).toThrow(ConfigError);
  });

  it('throws ConfigError on a dependency on an unknown field', () => {
    const unknownDep: Section = {
      id: 'deal',
      fields: [textField('a', ['ghost'])],
      grids: [],
    };
    expect(() => buildPlan(bundleWith([unknownDep]), [], [])).toThrow(/unknown field "ghost"/);
  });
});
