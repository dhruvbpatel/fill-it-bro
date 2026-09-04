import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const SCHEMAS_DIR = path.resolve(import.meta.dirname, '../schemas');
const EXAMPLES_DIR = path.resolve(import.meta.dirname, '../examples');

function schemaNames(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.replace(/\.schema\.json$/, ''))
    .sort();
}

// Cross-file $refs (e.g. "text-item.schema.json") are plain relative filenames, resolved
// here via loadSchema below. $id is stripped before compiling: Ajv would otherwise resolve
// those relative refs against it per RFC 3986 (fib.local is metadata only, not a real,
// fetchable domain), which doesn't match the on-disk filenames.
function loadSchemaForValidation(name: string): object {
  const raw = JSON.parse(readFileSync(path.join(SCHEMAS_DIR, `${name}.schema.json`), 'utf-8'));
  delete raw.$id;
  return raw;
}

describe.each(schemaNames())('%s', (name) => {
  it('validates its example', async () => {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      // "value" fields use type-array unions (e.g. ["string","number","boolean","null"]).
      allowUnionTypes: true,
      loadSchema: async (uri: string) =>
        loadSchemaForValidation(uri.replace(/\.schema\.json$/, '')),
    });
    addFormats(ajv);

    const validate = await ajv.compileAsync(loadSchemaForValidation(name));
    const example = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, `${name}.json`), 'utf-8'));

    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });
});
