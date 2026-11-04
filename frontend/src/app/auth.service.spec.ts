import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, TokenResponse } from './auth.service';

const response: TokenResponse = {
  access_token: 'fictitious-unit-test-token',
  token_type: 'Bearer',
  expires_in: 300,
  scope: 'api.read'
};

describe('AuthService memory session', () => {
  let auth: AuthService;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthService);
  });
  afterEach(() => {
    auth.logout();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('holds the token only in memory and clears it on logout', () => {
    const persistentWrite = vi.spyOn(Storage.prototype, 'setItem');
    auth.startSession(response);
    expect(auth.authenticated()).toBe(true);
    expect(auth.accessToken()).toBe(response.access_token);
    expect(persistentWrite).not.toHaveBeenCalled();
    auth.logout();
    expect(auth.authenticated()).toBe(false);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(false);
  });

  it('expires the session using expires_in without decoding the JWT', () => {
    auth.startSession({ ...response, expires_in: 2 });
    vi.advanceTimersByTime(1999);
    expect(auth.accessToken()).toBe(response.access_token);
    vi.advanceTimersByTime(1);
    expect(auth.accessToken()).toBeNull();
    expect(auth.authenticated()).toBe(false);
    expect(auth.expired()).toBe(true);
  });

  it('checks expiry when retrieving a token even before a suspended timer runs', () => {
    auth.startSession({ ...response, expires_in: 2 });
    vi.setSystemTime(Date.now() + 3000);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(true);
  });

  it('rejects malformed login responses', () => {
    for (const invalid of [
      { ...response, access_token: '' },
      { ...response, token_type: 'Basic' },
      { ...response, expires_in: 0 },
      { ...response, expires_in: 301 }
    ]) {
      expect(() => auth.startSession(invalid)).toThrow('Invalid local login response');
      expect(auth.accessToken()).toBeNull();
    }
  });

  it('does not let an old request invalidate a newer session', () => {
    auth.startSession(response);
    auth.startSession({ ...response, access_token: 'new-fictitious-token' });
    auth.expire(response.access_token);
    expect(auth.accessToken()).toBe('new-fictitious-token');
    auth.expire('new-fictitious-token');
    expect(auth.accessToken()).toBeNull();
  });
});
