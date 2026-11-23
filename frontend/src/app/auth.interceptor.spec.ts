import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { authInterceptor, isApiUrl } from './auth.interceptor';

describe('Bearer interceptor', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let auth: AuthService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.startSession({
      access_token: 'fictitious-unit-test-token', token_type: 'Bearer',
      expires_in: 300, scope: 'api.read'
    });
  });
  afterEach(() => {
    requests.verify();
    auth.logout();
  });

  it('adds Bearer to relative and absolute API URLs of the application origin', () => {
    for (const url of ['/api/message', window.location.origin + '/api/message']) {
      http.get(url).subscribe();
      const request = requests.expectOne(url);
      expect(request.request.headers.get('Authorization')).toBe('Bearer fictitious-unit-test-token');
      request.flush({ message: 'authenticated' });
    }
  });

  it('never adds the token to identity, third parties or misleading paths', () => {
    for (const url of [
      '/identity/token', 'https://third-party.example/api/message',
      '//third-party.example/api/message', '/api-evil/message', '/public/ping',
      '/api/%2e%2e/identity/token', '/api/../api/message'
    ]) {
      http.get(url).subscribe();
      const request = requests.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    }
  });

  it('rejects URL ambiguity before deciding to attach a token', () => {
    expect(isApiUrl('/api/message', window.location.origin)).toBe(true);
    expect(isApiUrl('/api', window.location.origin)).toBe(false);
    expect(isApiUrl('https://user:password@localhost/api/message', 'https://localhost')).toBe(false);
    expect(isApiUrl('/api/./message', window.location.origin)).toBe(false);
    expect(isApiUrl('/api/%6dessage', window.location.origin)).toBe(false);
  });

  it('invalidates the current API session on 401', () => {
    http.get('/api/message').subscribe({ error: () => undefined });
    requests.expectOne('/api/message').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(true);
  });

  it('keeps an authenticated session on insufficient permissions (403)', () => {
    http.get('/api/message').subscribe({ error: () => undefined });
    requests.expectOne('/api/message').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(auth.authenticated()).toBe(true);
    expect(auth.expired()).toBe(false);
  });

  it('does not attach an expired token', () => {
    auth.expire();
    http.get('/api/message').subscribe();
    const request = requests.expectOne('/api/message');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({});
  });
});
