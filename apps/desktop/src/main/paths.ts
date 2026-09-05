import path from 'node:path';

export function resolveConfigsDir(
  isPackaged: boolean,
  resourcesPath: string,
  moduleDir: string,
): string {
  return isPackaged
    ? path.join(resourcesPath, 'configs')
    : path.resolve(moduleDir, '../../../../configs');
}
