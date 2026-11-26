import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, tap } from 'rxjs';
import { AuthService, TokenResponse } from './auth.service';
import { I18nService, type LocalizedMessage } from './i18n/i18n.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="login-panel" aria-labelledby="login-title">
      <h1 id="login-title">{{ i18n.t('login.title') }}</h1>
      <p>{{ i18n.t('login.intro') }}</p>
      @if (auth.expired()) {
        <p role="status">{{ i18n.t('login.expired') }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
        <label for="username">{{ i18n.t('login.username') }}</label>
        <input id="username" formControlName="username" autocomplete="username"
          [readOnly]="busy()" aria-describedby="username-error"
          [attr.aria-invalid]="form.controls.username.touched && form.controls.username.invalid">
        <p id="username-error" class="field-error">
          @if (form.controls.username.touched && form.controls.username.invalid) {
            {{ i18n.t('login.usernameRequired') }}
          }
        </p>
        <label for="password">{{ i18n.t('login.password') }}</label>
        <input id="password" formControlName="password" type="password"
          autocomplete="current-password" [readOnly]="busy()" aria-describedby="password-error"
          [attr.aria-invalid]="form.controls.password.touched && form.controls.password.invalid">
        <p id="password-error" class="field-error">
          @if (form.controls.password.touched && form.controls.password.invalid) {
            {{ i18n.t('login.passwordRequired') }}
          }
        </p>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        <button type="submit" [disabled]="busy()">
          {{ i18n.t(busy() ? 'login.busy' : 'login.submit') }}
        </button>
      </form>
    </section>
  `
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly busy = signal(false);
  private readonly errorMessage = signal<LocalizedMessage | null>(null);
  readonly error = computed(() => this.i18n.message(this.errorMessage()));
  readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(128)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(1024)] })
  });

  submit(): void {
    if (this.busy()) return;
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.auth.logout();
    this.http.post<TokenResponse>('/identity/token', this.form.getRawValue()).pipe(
      tap(response => this.auth.startSession(response)),
      finalize(() => {
        this.form.controls.password.reset('');
        this.busy.set(false);
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => { void this.router.navigate(['/accueil']); },
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : -1;
        this.errorMessage.set({ key: status === 401 ? 'login.invalid'
          : status === 403 ? 'login.forbidden'
          : status === 0 ? 'login.unreachable' : 'login.failed' });
      }
    });
  }
}
