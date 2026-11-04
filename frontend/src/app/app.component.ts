import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main-content">Aller au contenu</a>
    <header>
      <span class="brand">Planification des auditions</span>
      <nav aria-label="Navigation principale">
        @if (auth.authenticated()) {
          <a routerLink="/accueil" routerLinkActive="active" ariaCurrentWhenActive="page">Accueil</a>
          <button type="button" (click)="logout()">Se déconnecter</button>
        } @else {
          <a routerLink="/login" routerLinkActive="active" ariaCurrentWhenActive="page">Connexion</a>
        }
      </nav>
    </header>
    <main id="main-content" tabindex="-1"><router-outlet /></main>
    <footer>Environnement local de développement — identité simulée</footer>
  `
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (this.auth.expired()) void this.router.navigate(['/login']);
    });
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
