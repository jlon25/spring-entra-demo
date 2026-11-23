import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('Protected navigation', () => {
  let auth: AuthService;
  const runGuard = () => TestBed.runInInjectionContext(
    () => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    auth = TestBed.inject(AuthService);
  });
  afterEach(() => auth.logout());

  it('redirects anonymous navigation to login with a UrlTree', () => {
    const result = runGuard();
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('allows an active session and rejects an expired one', () => {
    auth.startSession({
      access_token: 'fictitious-unit-test-token', token_type: 'Bearer',
      expires_in: 300, scope: 'api.read'
    });
    expect(runGuard()).toBe(true);
    auth.expire();
    expect(runGuard()).toBeInstanceOf(UrlTree);
  });
});
