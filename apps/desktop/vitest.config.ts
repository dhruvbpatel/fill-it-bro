import { defineConfig } from 'vitest/config';

// `tests/` holds @playwright/test specs (run via `playwright test`); vitest
// must only pick up the plain unit tests under `src/`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
