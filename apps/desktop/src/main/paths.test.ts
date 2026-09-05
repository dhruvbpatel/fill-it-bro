import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfigsDir } from './paths.js';

describe('resolveConfigsDir', () => {
  it('resolves the repository configs directory from the built main module in development', () => {
    const moduleDir = path.join('/repo', 'apps', 'desktop', 'dist', 'main');

    expect(resolveConfigsDir(false, '/resources', moduleDir)).toBe(path.join('/repo', 'configs'));
  });

  it('resolves packaged configs beneath process.resourcesPath', () => {
    expect(resolveConfigsDir(true, '/app/resources', '/unused')).toBe(
      path.join('/app', 'resources', 'configs'),
    );
  });
});
