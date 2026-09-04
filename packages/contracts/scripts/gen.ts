// Regenerates TS types (json-schema-to-typescript) and Pydantic v2 models (datamodel-codegen)
// from packages/contracts/schemas/*.schema.json. Run via `pnpm contracts:gen`. Always a full
// regeneration (never incremental) so idempotency and stale-file cleanup both just work.
//
// Both tools resolve the schemas' cross-file $refs (plain relative filenames, e.g.
// "text-item.schema.json") against each file's on-disk location, not against the schemas'
// $id (which is metadata only — fib.local is not a real, fetchable domain). No pre-bundling
// or custom $ref resolver is needed: json-schema-to-typescript is given `cwd: SCHEMAS_DIR`,
// and datamodel-codegen is simply pointed at the whole schemas directory.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(CONTRACTS_DIR, '../..');

const SCHEMAS_DIR = path.join(CONTRACTS_DIR, 'schemas');
const GENERATED_DIR = path.join(CONTRACTS_DIR, 'src/generated');
const PY_OUT_DIR = path.join(REPO_ROOT, 'apps/service/src/fib_service/contracts');

function schemaNames(): string[] {
  return readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => f.replace(/\.schema\.json$/, ''))
    .sort();
}

// A single combined compile() call, one root property per schema, so
// json-schema-to-typescript walks and names every cross-referenced schema exactly once.
// Calling compile() separately per schema (with declareExternallyReferenced: true) would
// have each file redeclare every schema it transitively references, causing duplicate
// exported names once the files are re-exported together from one barrel.
const ROOT_NAME = 'Schemas';

async function genTypeScript(names: string[]): Promise<void> {
  rmSync(GENERATED_DIR, { recursive: true, force: true });
  mkdirSync(GENERATED_DIR, { recursive: true });

  const root = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: ROOT_NAME,
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, { $ref: `${name}.schema.json` }])),
    required: names,
    additionalProperties: false,
  };

  const ts = await compile(root, ROOT_NAME, {
    cwd: SCHEMAS_DIR,
    declareExternallyReferenced: true,
  });

  // Drop the synthetic root interface itself (its kebab-case-keyed shape only exists to
  // make compile() visit every schema; it isn't part of the public contract).
  const withoutRoot = ts
    .split(/\n(?=export )/)
    .filter((block) => !new RegExp(`^export (?:interface|type) ${ROOT_NAME}\\b`).test(block))
    .join('\n');

  writeFileSync(path.join(GENERATED_DIR, 'schemas.ts'), withoutRoot);
  writeFileSync(
    path.join(CONTRACTS_DIR, 'src/index.ts'),
    "export * from './generated/schemas.js';\n",
  );
}

function genPython(): void {
  rmSync(PY_OUT_DIR, { recursive: true, force: true });
  mkdirSync(PY_OUT_DIR, { recursive: true });

  execFileSync(
    'uv',
    [
      'run',
      '--group',
      'codegen',
      'datamodel-codegen',
      '--input',
      SCHEMAS_DIR,
      '--input-file-type',
      'jsonschema',
      '--output',
      PY_OUT_DIR,
      '--output-model-type',
      'pydantic_v2.BaseModel',
      '--target-python-version',
      '3.12',
      '--use-schema-description',
      // Keep generated Python attribute names identical to the JSON camelCase keys
      // (no --snake-case-field): avoids alias/by_alias round-trip bookkeeping in
      // generated code that is never hand-edited.
      '--disable-timestamp',
      // Pin formatters explicitly: silences a FutureWarning about the black/isort
      // default changing, with no behavior change.
      '--formatters',
      'black',
      'isort',
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}

async function main(): Promise<void> {
  const names = schemaNames();
  await genTypeScript(names);
  genPython();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
