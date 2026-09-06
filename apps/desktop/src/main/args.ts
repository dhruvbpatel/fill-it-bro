export interface HostArgs {
  dealId: string;
  formId: string;
  smoke: boolean;
}

/**
 * Accepts `--dealId=<id> --formId=<id>` or positional `<dealId> <formId>`
 * (the deploy pipeline invokes the packaged exe as `fib.exe <dealId> <formId>`).
 * `--smoke` prints the CDP URL, waits for `/json/version`, then exits 0 (CI smoke).
 * Returns null when either id is missing.
 */
export function parseArgs(argv: string[]): HostArgs | null {
  let dealId: string | undefined;
  let formId: string | undefined;
  let smoke = false;
  const positional: string[] = [];

  for (const arg of argv) {
    const dealMatch = /^--dealId=(.+)$/.exec(arg);
    const formMatch = /^--formId=(.+)$/.exec(arg);
    if (dealMatch) {
      dealId = dealMatch[1];
    } else if (formMatch) {
      formId = formMatch[1];
    } else if (arg === '--smoke') {
      smoke = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  if (dealId === undefined && positional[0] !== undefined) dealId = positional[0];
  if (formId === undefined && positional[1] !== undefined) formId = positional[1];

  if (!dealId || !formId) return null;
  return { dealId, formId, smoke };
}
