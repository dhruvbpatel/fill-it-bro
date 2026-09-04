import { describe, expect, it } from 'vitest';
import { APP_NAME } from './version';

describe('desktop scaffold', () => {
  it('has an app name', () => {
    expect(APP_NAME).toBe('fill-it-bro-desktop');
  });
});
