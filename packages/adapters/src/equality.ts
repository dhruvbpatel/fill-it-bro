import type { WidgetAdapter } from './adapter.js';

/**
 * Control-aware value equality for adapter verify loops.
 * - `date`: ISO compare (both sides must be `YYYY-MM-DD`).
 * - numbers: strip thousands separators and currency symbols, compare numerically.
 * - everything else: trim, collapse whitespace, case-insensitive.
 */
export function valuesEqual(control: WidgetAdapter['control'], a: string, b: string): boolean {
  if (control === 'date') {
    const isoA = asIsoDate(a);
    const isoB = asIsoDate(b);
    if (isoA !== null && isoB !== null) return isoA === isoB;
  } else {
    const numA = asNumber(a);
    const numB = asNumber(b);
    if (numA !== null && numB !== null) return numA === numB;
  }
  return collapse(a) === collapse(b);
}

function asIsoDate(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function asNumber(value: string): number | null {
  const stripped = value.replace(/[,\s$€£¥]/g, '');
  if (stripped === '' || !/^[+-]?\d+(\.\d+)?$/.test(stripped)) return null;
  return Number(stripped);
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
