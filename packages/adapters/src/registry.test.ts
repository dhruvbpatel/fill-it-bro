import { describe, expect, it } from 'vitest';
import { registry } from './index.js';

describe('@fib/adapters registry', () => {
  it('is populated at import with the basic adapters, searchSelect and agGridCell', () => {
    expect([...registry.keys()].sort()).toEqual([
      'agGridCell',
      'button',
      'checkbox',
      'date',
      'searchSelect',
      'select',
      'tab',
      'text',
    ]);
  });

  it('declares a control matching each registry key', () => {
    for (const [key, adapter] of registry) {
      expect(adapter.control).toBe(key);
    }
  });
});
