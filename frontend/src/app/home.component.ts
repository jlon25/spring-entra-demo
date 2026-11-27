import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AuthService } from './auth.service';
import { I18nService, type LocalizedMessage } from './i18n/i18n.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="home-title" [attr.aria-busy]="busy()">
      <h1 id="home-title">{{ i18n.t('home.title') }}</h1>
      <p>{{ i18n.t('home.intro') }}</p>
      <button type="button" (click)="checkApi()" [disabled]="busy()">
        {{ i18n.t(busy() ? 'home.busy' : 'home.check') }}
      </button>
      @if (message()) { <p role="status">{{ i18n.t('home.confirmed', { message: message() }) }}</p> }
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @if (auth.hasScope('hearing-types.read')) {
        <p><a routerLink="/types-audition">{{ i18n.t('home.types') }}</a></p>
      }
    </section>
  `
})
export class HomeComponent {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly busy = signal(false);
  readonly message = signal('');
  private readonly errorMessage = signal<LocalizedMessage | null>(null);
  readonly error = computed(() => this.i18n.message(this.errorMessage()));

  checkApi(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.errorMessage.set(null);
    this.http.get<{ message: string }>('/api/message').pipe(
      finalize(() => this.busy.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: response => this.message.set(response.message),
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : -1;
        this.errorMessage.set({ key: status === 403 ? 'home.forbidden'
          : status === 401 ? 'home.unauthorized' : 'home.unreachable' });
      }
    });
  }
}
