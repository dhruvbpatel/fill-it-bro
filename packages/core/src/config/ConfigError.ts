/**
 * Error thrown when a form's config files fail schema validation or cross-file checks.
 * `file` is the path of the offending file relative to the configs directory
 * (e.g. `forms/fixtureDeal/form.json` or `templates.json`); `path` is a JSON
 * pointer (RFC 6901) to the offending value inside that file, `''` for the root.
 */
export class ConfigError extends Error {
  readonly file: string;
  readonly path: string;

  constructor(message: string, file: string, path: string) {
    super(`${file}${path}: ${message}`);
    this.name = 'ConfigError';
    this.file = file;
    this.path = path;
  }
}
