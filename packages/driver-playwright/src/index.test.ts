import { describe, expect, it } from 'vitest';
import { packageName } from './index';

describe('@fib/driver-playwright scaffold', () => {
  it('exports its own package name', () => {
    expect(packageName).toBe('@fib/driver-playwright');
  });
});
