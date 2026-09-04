import { Component, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

const ISSUER_NAMES = [
  'Goldman Sachs Incorporated',
  'Goldman Sachs Asset Management',
  'Morgan Stanley & Co',
  'JPMorgan Chase Bank',
] as const;

const SEARCH_DELAY_MS = 1500;
const FLICKER_DELAY_MS = 200;

@Component({
  selector: 'app-fib-search-select',
  standalone: true,
  templateUrl: './fib-search-select.component.html',
  styleUrl: './fib-search-select.component.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => FibSearchSelectComponent),
      multi: true,
    },
  ],
})
export class FibSearchSelectComponent implements ControlValueAccessor {
  open = signal(false);
  query = signal('');
  loading = signal(false);
  renderedOptions = signal<string[]>([]);
  flickerNonce = signal(0);
  selectedValue = signal('');
  disabled = signal(false);

  private searchTimer?: ReturnType<typeof setTimeout>;
  private flickerTimer?: ReturnType<typeof setTimeout>;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: string | null): void {
    this.selectedValue.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  togglePanel(): void {
    this.open.update((v) => !v);
  }

  onSearchInput(raw: string): void {
    this.query.set(raw);
    clearTimeout(this.searchTimer);
    clearTimeout(this.flickerTimer);
    this.loading.set(true);
    this.renderedOptions.set([]);

    this.searchTimer = setTimeout(() => {
      const needle = raw.trim().toLowerCase();
      const filtered = ISSUER_NAMES.filter((name) => name.toLowerCase().includes(needle));
      this.loading.set(false);
      this.renderedOptions.set(filtered);

      // One-shot "flicker" 200ms after the first render: same option text, but a fresh
      // track key forces Angular to tear down and recreate the <li> nodes rather than
      // patch them in place. This reproduces a real race that later tickets (Playwright
      // driver, searchSelect adapter) must handle by re-querying rather than holding a
      // stale element handle. Do not change the template's track expression to key on
      // option text alone -- that would let Angular reuse nodes and defeat this entirely.
      this.flickerTimer = setTimeout(() => {
        this.flickerNonce.update((n) => n + 1);
        this.renderedOptions.set([...filtered]);
      }, FLICKER_DELAY_MS);
    }, SEARCH_DELAY_MS);
  }

  selectOption(option: string): void {
    this.selectedValue.set(option);
    this.onChange(option);
    this.onTouched();
    this.open.set(false);
  }
}
