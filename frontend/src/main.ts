import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch(() => {
  // Avoid logging runtime objects that might contain sensitive data.
  document.body.textContent = 'Impossible de démarrer l’application.';
});
