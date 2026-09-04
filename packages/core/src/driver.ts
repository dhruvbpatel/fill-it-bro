export interface LocatorSpec {
  formControlName?: string;
  label?: string;
  role?: { name: string; role: string };
  css?: string;
  within?: LocatorSpec;
  nth?: number;
}

export type Ref = { ref: string };

export interface BrowserDriver {
  connect(cdpUrl: string, pageUrl: RegExp): Promise<void>;
  click(t: LocatorSpec | Ref): Promise<void>;
  type(t: LocatorSpec | Ref, text: string, opts?: { clear?: boolean }): Promise<void>;
  press(t: LocatorSpec | Ref, key: string): Promise<void>;
  readValue(t: LocatorSpec | Ref): Promise<string | null>;
  readText(t: LocatorSpec | Ref): Promise<string>;
  count(t: LocatorSpec): Promise<number>;
  waitFor(
    t: LocatorSpec | Ref,
    state: 'visible' | 'hidden' | 'attached',
    timeoutMs: number,
  ): Promise<void>;
  waitStable(t: LocatorSpec, settleMs: number, maxMs: number): Promise<void>;
  ariaSnapshot(scope?: LocatorSpec): Promise<{ yaml: string; refs: string[] }>;
  setNeverClick(patterns: LocatorSpec[]): void;
}

export class NeverClickError extends Error {
  constructor(message = 'refused to click: target matches a neverClick pattern') {
    super(message);
    this.name = 'NeverClickError';
  }
}
