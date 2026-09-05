import type { AdapterCtx, WidgetAdapter } from '../adapter.js';
import type { LocatorSpec } from '@fib/core';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/**
 * Normalise a date-ish input to `YYYY-MM-DD`.
 * Accepts ISO (always), `D Month YYYY` (always), and `DD/MM/YYYY` or `MM/DD/YYYY`
 * per `profile.dateFormat` (default ISO, i.e. slash formats need an explicit format).
 */
export function normaliseDate(value: string, dateFormat?: string): string {
  const input = value.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), value);

  const named = /^(\d{1,2}) ([A-Za-z]+)\.? (\d{4})$/.exec(input);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month !== undefined) return toIso(Number(named[3]), month, Number(named[1]), value);
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
  if (slashed && dateFormat === 'MM/DD/YYYY') {
    return toIso(Number(slashed[3]), Number(slashed[1]), Number(slashed[2]), value);
  }
  if (slashed && dateFormat === 'DD/MM/YYYY') {
    return toIso(Number(slashed[3]), Number(slashed[2]), Number(slashed[1]), value);
  }

  throw new Error(
    `date: cannot parse "${value}"${dateFormat ? ` with dateFormat ${dateFormat}` : ' (default ISO)'}`,
  );
}

function toIso(year: number, month: number, day: number, original: string): string {
  if (month < 1 || month > 12) throw new Error(`date: invalid month in "${original}"`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) throw new Error(`date: invalid day in "${original}"`);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

export const dateAdapter: WidgetAdapter = {
  control: 'date',

  async write(ctx: AdapterCtx, target: LocatorSpec, value: string, profile?) {
    const iso = normaliseDate(value, profile?.dateFormat);
    await ctx.driver.fill(target, iso);
    await ctx.driver.press(target, 'Tab');
    return {};
  },

  async read(ctx: AdapterCtx, target: LocatorSpec): Promise<string | null> {
    return ctx.driver.readValue(target);
  },
};
