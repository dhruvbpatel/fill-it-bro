import { Routes } from '@angular/router';
import { DealPageComponent } from './deal-page/deal-page.component';

export const routes: Routes = [
  { path: 'deal/:dealId', component: DealPageComponent },
  { path: '', redirectTo: 'deal/1', pathMatch: 'full' },
];
