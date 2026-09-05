import type { FallbackAgent, FallbackOutcome } from './types.js';

/**
 * T19 stub used until the real a11y fallback agent (T20) exists. The
 * parameterless `run` is assignable to the `FallbackAgent` signature.
 */
export class NoopFallbackAgent implements FallbackAgent {
  async run(): Promise<FallbackOutcome> {
    return { ok: false, reason: 'no fallback configured' };
  }
}
