import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// The `ag-grid-community` npm package (as opposed to the granular `@ag-grid-community/*`
// scoped packages) self-registers all community modules; calling ModuleRegistry.registerModules()
// here as well trips AG Grid's "mixing modules and packages" warning, so we don't.

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
