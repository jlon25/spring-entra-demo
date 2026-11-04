import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="home-title" [attr.aria-busy]="busy()">
      <h1 id="home-title">Accueil</h1>
      <p>Vous êtes connecté au simulateur local.</p>
      <button type="button" (click)="checkApi()" [disabled]="busy()">
        {{ busy() ? 'Vérification en cours…' : 'Vérifier l’accès à l’API' }}
      </button>
      @if (message()) { <p role="status">Accès à l’API confirmé : {{ message() }}</p> }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      <p>La gestion des types d’audition sera ajoutée dans une prochaine étape.</p>
    </section>
  `
})
export class HomeComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly error = signal('');

  checkApi(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    this.http.get<{ message: string }>('/api/message').pipe(
      finalize(() => this.busy.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: response => this.message.set(response.message),
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : -1;
        this.error.set(status === 403 ? 'Votre session est valide, mais les droits sont insuffisants.'
          : status === 401 ? 'Session refusée. Connectez-vous à nouveau.'
          : 'L’API est inaccessible. Réessayez ultérieurement.');
      }
    });
  }
}
