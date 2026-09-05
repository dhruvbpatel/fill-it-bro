// `pnpm validate-configs` — loads and validates every form bundle under
// <configsDir>/forms (default: the repo's configs/ directory). Exits non-zero
// if any form fails, printing each failure with its file and JSON pointer path.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError } from './ConfigError.js';
import { loadFormBundle } from './loadFormConfig.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const configsDir = process.argv[2] ?? path.join(REPO_ROOT, 'configs');
const formsDir = path.join(configsDir, 'forms');

const formIds = readdirSync(formsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (formIds.length === 0) {
  console.error(`validate-configs: no form directories found under ${formsDir}`);
  process.exit(1);
}

let failures = 0;
for (const formId of formIds) {
  try {
    const bundle = loadFormBundle(configsDir, formId);
    console.log(`ok ${formId} (${bundle.urlTemplate})`);
  } catch (err) {
    failures++;
    const detail = err instanceof ConfigError ? err.message : String(err);
    console.error(`FAIL ${formId}: ${detail}`);
  }
}
process.exit(failures > 0 ? 1 : 0);
