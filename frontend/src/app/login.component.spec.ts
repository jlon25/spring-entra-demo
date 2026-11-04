import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from './auth.service';

describe('Local login form', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.inject(AuthService).logout();
    vi.restoreAllMocks();
  });

  it('does not submit an invalid form', () => {
    const component = TestBed.createComponent(LoginComponent).componentInstance;
    component.submit();
    TestBed.inject(HttpTestingController).expectNone('/identity/token');
    expect(component.form.controls.username.touched).toBe(true);
    expect(component.form.controls.password.touched).toBe(true);
  });

  it('establishes an in-memory session and erases the password after success', () => {
    const component = TestBed.createComponent(LoginComponent).componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    component.form.setValue({ username: 'local-user', password: 'fictitious-test-password' });
    component.submit();
    const request = TestBed.inject(HttpTestingController).expectOne('/identity/token');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.username).toBe('local-user');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({
      access_token: 'fictitious-unit-test-token', token_type: 'Bearer', expires_in: 300, scope: 'api.read'
    });
    expect(TestBed.inject(AuthService).authenticated()).toBe(true);
    expect(component.form.controls.password.value).toBe('');
    expect(component.busy()).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/accueil']);
  });

  it('shows a generic credential error and erases the password after refusal', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.form.setValue({ username: 'local-user', password: 'fictitious-wrong-password' });
    component.submit();
    TestBed.inject(HttpTestingController).expectOne('/identity/token')
      .flush({ error: 'invalid_credentials' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(component.error()).toBe('Nom d’utilisateur ou mot de passe incorrect.');
    expect(component.form.controls.password.value).toBe('');
    expect(TestBed.inject(AuthService).authenticated()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('Nom d’utilisateur ou mot de passe incorrect.');
    expect(fixture.nativeElement.querySelector('label[for="password"]')).not.toBeNull();
  });

  it('distinguishes an unreachable service from invalid credentials', () => {
    const component = TestBed.createComponent(LoginComponent).componentInstance;
    component.form.setValue({ username: 'local-user', password: 'fictitious-test-password' });
    component.submit();
    TestBed.inject(HttpTestingController).expectOne('/identity/token').error(new ProgressEvent('error'));
    expect(component.error()).toContain('Service inaccessible');
    expect(component.form.controls.password.value).toBe('');
  });
});
