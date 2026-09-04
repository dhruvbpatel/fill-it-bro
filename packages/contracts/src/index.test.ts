import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@fib/contracts scaffold', () => {
  it('exports its own package name', () => {
    expect(packageName).toBe('@fib/contracts');
  });
});
