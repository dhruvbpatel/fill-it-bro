import { describe, expect, it } from 'vitest';
import { registry } from './index.js';

describe('@fib/adapters registry', () => {
  it('is populated at import with the basic adapters and searchSelect', () => {
    expect([...registry.keys()].sort()).toEqual([
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
