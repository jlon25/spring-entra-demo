import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, tap } from 'rxjs';
import { AuthService, TokenResponse } from './auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="login-title">
      <h1 id="login-title">Connexion locale</h1>
      <p>Utilisez le compte du simulateur de développement.</p>
      @if (auth.expired()) {
        <p role="status">Votre session a expiré. Connectez-vous à nouveau.</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" [attr.aria-busy]="busy()">
        <label for="username">Nom d’utilisateur</label>
        <input id="username" formControlName="username" autocomplete="username"
          [readOnly]="busy()" aria-describedby="username-error"
          [attr.aria-invalid]="form.controls.username.touched && form.controls.username.invalid">
        <p id="username-error" class="field-error">
          @if (form.controls.username.touched && form.controls.username.invalid) {
            Renseignez un nom d’utilisateur (128 caractères maximum).
          }
        </p>
        <label for="password">Mot de passe</label>
        <input id="password" formControlName="password" type="password"
          autocomplete="current-password" [readOnly]="busy()" aria-describedby="password-error"
          [attr.aria-invalid]="form.controls.password.touched && form.controls.password.invalid">
        <p id="password-error" class="field-error">
          @if (form.controls.password.touched && form.controls.password.invalid) {
            Renseignez le mot de passe du simulateur.
          }
        </p>
        @if (error()) { <p role="alert">{{ error() }}</p> }
        <button type="submit" [disabled]="busy()">
          {{ busy() ? 'Connexion en cours…' : 'Se connecter' }}
        </button>
      </form>
    </section>
  `
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(128)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(1024)] })
  });

  submit(): void {
    if (this.busy()) return;
    this.error.set('');
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
        this.error.set(status === 401 ? 'Nom d’utilisateur ou mot de passe incorrect.'
          : status === 403 ? 'La connexion à ce service est refusée.'
          : status === 0 ? 'Service inaccessible. Vérifiez le tunnel et les conteneurs.'
          : 'La connexion a échoué. Réessayez ultérieurement.');
      }
    });
  }
}
