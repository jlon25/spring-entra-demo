import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_SESSION_STORAGE, AuthService, SESSION_STORAGE_KEY, TokenResponse } from './auth.service';

const response: TokenResponse = {
  access_token: 'fictitious-unit-test-token',
  token_type: 'Bearer',
  expires_in: 300,
  scope: 'api.read'
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

describe('AuthService tab session', () => {
  let auth: AuthService;
  let storage: Storage;

  function recreate(value: Storage | null = storage): AuthService {
    // Destroy stops the old timer without deleting the tab's persisted session.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AUTH_SESSION_STORAGE, useValue: value }]
    });
    auth = TestBed.inject(AuthService);
    return auth;
  }

  function stored(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: 1,
      token: response.access_token,
      expiresAt: Date.now() + 300_000,
      permissions: ['api.read'],
      ...overrides
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    storage = memoryStorage();
    recreate();
  });

  afterEach(() => {
    auth.logout();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stores only the tab session and clears it on logout, without using localStorage', () => {
    const localWrite = vi.spyOn(Storage.prototype, 'setItem');
    auth.startSession(response);
    expect(auth.authenticated()).toBe(true);
    expect(auth.accessToken()).toBe(response.access_token);
    expect(JSON.parse(storage.getItem(SESSION_STORAGE_KEY)!)).toEqual({
      version: 1, token: response.access_token, expiresAt: Date.now() + 300_000, permissions: ['api.read']
    });
    expect(localWrite).not.toHaveBeenCalled();
    auth.logout();
    expect(auth.authenticated()).toBe(false);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(false);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('restores a session synchronously before route guards use it', () => {
    storage.setItem(SESSION_STORAGE_KEY, stored({ permissions: ['hearing-types.read'] }));
    recreate();
    expect(auth.authenticated()).toBe(true);
    expect(auth.accessToken()).toBe(response.access_token);
    expect(auth.hasScope('hearing-types.read')).toBe(true);
    expect(auth.hasScope('hearing-types.write')).toBe(false);
  });

  it('survives service recreation without extending the absolute expiry', () => {
    auth.startSession({ ...response, expires_in: 2 });
    const record = storage.getItem(SESSION_STORAGE_KEY);
    vi.advanceTimersByTime(1000);
    recreate();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(record);
    expect(auth.accessToken()).toBe(response.access_token);
    vi.advanceTimersByTime(999);
    expect(auth.accessToken()).toBe(response.access_token);
    vi.advanceTimersByTime(1);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(true);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('expires the session using expires_in without decoding the JWT', () => {
    auth.startSession({ ...response, expires_in: 2 });
    vi.advanceTimersByTime(1999);
    expect(auth.accessToken()).toBe(response.access_token);
    vi.advanceTimersByTime(1);
    expect(auth.accessToken()).toBeNull();
    expect(auth.authenticated()).toBe(false);
    expect(auth.expired()).toBe(true);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('uses the configured lifetime above five minutes without another frontend setting', () => {
    auth.startSession({ ...response, expires_in: 1800 });
    vi.advanceTimersByTime(300_000);
    expect(auth.accessToken()).toBe(response.access_token);
    vi.advanceTimersByTime(1_500_000);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(true);
  });

  it('checks expiry when retrieving a token before a suspended timer runs', () => {
    auth.startSession({ ...response, expires_in: 2 });
    vi.setSystemTime(Date.now() + 3000);
    expect(auth.accessToken()).toBeNull();
    expect(auth.expired()).toBe(true);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('purges an expired stored session and reports expiration', () => {
    storage.setItem(SESSION_STORAGE_KEY, stored({ expiresAt: Date.now() - 1 }));
    recreate();
    expect(auth.accessToken()).toBeNull();
    expect(auth.authenticated()).toBe(false);
    expect(auth.expired()).toBe(true);
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('purges corrupt or malformed records without treating them as authenticated sessions', () => {
    const invalid = [
      'not-json', 'null', '[]', '{}',
      stored({ version: 2 }), stored({ token: '' }), stored({ token: 123 }),
      stored({ expiresAt: 'tomorrow' }), stored({ expiresAt: 0 }), stored({ expiresAt: 1.5 }),
      stored({ expiresAt: Date.now() + 2_147_483_648 }),
      stored({ permissions: 'api.read' }), stored({ permissions: ['api.read', 1] }),
      stored({ unexpected: true })
    ];
    for (const record of invalid) {
      storage.setItem(SESSION_STORAGE_KEY, record);
      recreate();
      expect(auth.accessToken()).toBeNull();
      expect(auth.expired()).toBe(false);
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    }
  });

  it('rejects malformed login responses without persisting them', () => {
    for (const invalid of [
      { ...response, access_token: '' },
      { ...response, token_type: 'Basic' },
      { ...response, expires_in: 0 },
      { ...response, expires_in: -1 },
      { ...response, expires_in: 1.5 },
      { ...response, expires_in: Number.NaN },
      { ...response, expires_in: Number.POSITIVE_INFINITY },
      { ...response, expires_in: 2_147_484 }
    ]) {
      expect(() => auth.startSession(invalid)).toThrow('Invalid local login response');
      expect(auth.accessToken()).toBeNull();
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    }
  });

  it('exposes permission hints without inferring additional rights and clears them on logout/expiry', () => {
    auth.startSession({ ...response, scope: 'hearing-types.read' });
    expect(auth.hasScope('hearing-types.read')).toBe(true);
    expect(auth.hasScope('hearing-types.write')).toBe(false);
    auth.startSession({ ...response, scope: 'hearing-types.write' });
    expect(auth.hasScope('hearing-types.read')).toBe(false);
    expect(auth.hasScope('hearing-types.write')).toBe(true);
    auth.logout();
    expect(auth.hasScope('hearing-types.write')).toBe(false);
    auth.startSession({ ...response, scope: 'hearing-types.read', expires_in: 1 });
    vi.advanceTimersByTime(1000);
    expect(auth.hasScope('hearing-types.read')).toBe(false);
  });

  it('does not let an old request clear a newer session or its stored record', () => {
    auth.startSession(response);
    auth.startSession({ ...response, access_token: 'new-fictitious-token' });
    const record = storage.getItem(SESSION_STORAGE_KEY);
    auth.expire(response.access_token);
    expect(auth.accessToken()).toBe('new-fictitious-token');
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBe(record);
    auth.expire('new-fictitious-token');
    expect(auth.accessToken()).toBeNull();
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('works in memory when storage reads are denied', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    recreate();
    expect(auth.startSession(response)).toBeUndefined();
    expect(auth.accessToken()).toBe(response.access_token);
    auth.logout();
    expect(auth.accessToken()).toBeNull();
  });

  it('works in memory when persisting is denied and does not restore that session', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    auth.startSession(response);
    expect(auth.accessToken()).toBe(response.access_token);
    recreate();
    expect(auth.accessToken()).toBeNull();
  });

  it('still clears memory and invalidates a record if removal alone is denied', () => {
    auth.startSession(response);
    vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new Error('Removal denied'); });
    auth.logout();
    expect(auth.accessToken()).toBeNull();
    recreate();
    expect(auth.authenticated()).toBe(false);
  });

  it('handles absence of storage, including non-browser contexts', () => {
    recreate(null);
    auth.startSession(response);
    expect(auth.accessToken()).toBe(response.access_token);
    auth.expire(response.access_token);
    expect(auth.expired()).toBe(true);
  });

  it('catches access to a blocked browser sessionStorage property', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('Storage denied'); });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(AuthService);
    auth.startSession(response);
    expect(auth.accessToken()).toBe(response.access_token);
    auth.logout();
    expect(auth.accessToken()).toBeNull();
  });

  it('does not leave duplicate expiry timers behind when a service is destroyed', () => {
    auth.startSession(response);
    expect(vi.getTimerCount()).toBe(1);
    auth.ngOnDestroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(storage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });
});
