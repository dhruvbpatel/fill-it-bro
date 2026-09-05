import type { BrowserDriver, LocatorSpec } from '@fib/core';
import type { WidgetProfile as BaseWidgetProfile } from '@fib/contracts';

/**
 * Contracts profile extended with the date adapter's input format hint
 * (`DD/MM/YYYY` | `MM/DD/YYYY`); added by ticket 16, which owns basic adapters.
 */
export type WidgetProfile = BaseWidgetProfile & { dateFormat?: string };

export type MatchOptionResult = {
  index: number | null;
  via: 'exact' | 'fuzzy' | 'llm';
  confidence: number;
};

export interface AdapterCtx {
  driver: BrowserDriver;
  matchOption: (wanted: string, options: string[]) => Promise<MatchOptionResult>;
  log: (msg: string) => void;
}

export interface WidgetAdapter {
  control:
    'text' | 'select' | 'searchSelect' | 'checkbox' | 'date' | 'button' | 'tab' | 'agGridCell';
  write(
    ctx: AdapterCtx,
    target: LocatorSpec,
    value: string,
    profile?: WidgetProfile,
  ): Promise<{ via?: 'exact' | 'fuzzy' | 'llm' }>;
  read(ctx: AdapterCtx, target: LocatorSpec, profile?: WidgetProfile): Promise<string | null>;
  options?(ctx: AdapterCtx, target: LocatorSpec, profile?: WidgetProfile): Promise<string[]>;
}

export const registry: Map<WidgetAdapter['control'], WidgetAdapter> = new Map();
