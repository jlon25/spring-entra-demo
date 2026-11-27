import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { I18nService } from './i18n/i18n.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">{{ i18n.t('app.skip') }}</a>
    <header>
      <div class="header-inner">
        <span class="brand">{{ i18n.t('app.title') }}</span>
        <nav [attr.aria-label]="i18n.t('app.navigation')">
          @if (auth.authenticated()) {
            <a routerLink="/accueil" routerLinkActive="active" ariaCurrentWhenActive="page">{{ i18n.t('app.home') }}</a>
            @if (auth.hasScope('hearing-types.read')) {
              <a routerLink="/types-audition" routerLinkActive="active" ariaCurrentWhenActive="page">{{ i18n.t('app.types') }}</a>
            }
            @if (auth.hasScope('heard-persons.read')) {
              <a routerLink="/personnes-auditionnees" routerLinkActive="active" ariaCurrentWhenActive="page">{{ i18n.t('app.persons') }}</a>
            }
          } @else {
            <a routerLink="/login" routerLinkActive="active" ariaCurrentWhenActive="page">{{ i18n.t('app.login') }}</a>
          }
        </nav>
        <div class="header-actions">
          <div class="language-picker">
            <select id="language" [attr.aria-label]="i18n.t('app.language')" [value]="i18n.lang()" (change)="changeLanguage($event)">
              <option value="fr" lang="fr">Français</option>
              <option value="de" lang="de">Deutsch</option>
              <option value="it" lang="it">Italiano</option>
            </select>
          </div>
          @if (auth.authenticated()) {
            <button type="button" (click)="logout()">{{ i18n.t('app.logout') }}</button>
          }
        </div>
      </div>
    </header>
    <main id="main-content" tabindex="-1"><router-outlet /></main>
    <footer>{{ i18n.t('app.footer') }}</footer>
  `
})
export class AppComponent {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.expired()) void this.router.navigate(['/login']);
    });
  }

  changeLanguage(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.i18n.setLanguage(event.target.value);
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
