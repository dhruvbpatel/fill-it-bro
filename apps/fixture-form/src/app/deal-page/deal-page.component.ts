import { Component, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { FibSearchSelectComponent } from '../fib-search-select/fib-search-select.component';
import { PartiesGridComponent } from '../parties-grid/parties-grid.component';

type Tab = 'deal' | 'parties';

@Component({
  selector: 'app-deal-page',
  standalone: true,
  imports: [ReactiveFormsModule, FibSearchSelectComponent, PartiesGridComponent],
  templateUrl: './deal-page.component.html',
  styleUrl: './deal-page.component.css',
})
export class DealPageComponent {
  dealId = input<string>('1');

  activeTab = signal<Tab>('deal');
  feesRevealed = signal(false);

  private fb = inject(NonNullableFormBuilder);

  partiesArray = this.fb.array([
    this.fb.group({ partyName: '', role: '', amount: '' }),
  ]);

  form = this.fb.group({
    issuerName: '',
    dealAmount: '',
    currency: '',
    settlementDate: '',
    isConfidential: false,
    feeType: '',
    parties: this.partiesArray,
  });

  modelJson = signal(JSON.stringify(this.form.value));

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.modelJson.set(JSON.stringify(this.form.value));
    });
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
  }

  revealFees(): void {
    this.feesRevealed.set(true);
  }

  onSubmit(): void {
    (window as unknown as { __submitted?: boolean }).__submitted = true;
  }
}
