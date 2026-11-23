import { Injectable, InjectionToken, OnDestroy, computed, inject, signal } from '@angular/core';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface Session {
  token: string;
  expiresAt: number;
  permissions: readonly string[];
}

export const SESSION_STORAGE_KEY = 'auditions.auth.session.v1';
const MAX_TIMER_MS = 2_147_483_647;

/** Storage can be denied by browser policy; authentication must still work in memory. */
export const AUTH_SESSION_STORAGE = new InjectionToken<Storage | null>('AUTH_SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return typeof window === 'undefined' ? null : window.sessionStorage;
    } catch {
      return null;
    }
  }
});

/** Tab-scoped continuity only. The API remains authoritative for JWT validation. */
@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private storage = inject(AUTH_SESSION_STORAGE);
  private readonly session = signal<Session | null>(null);
  private readonly expiredState = signal(false);
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly expired = this.expiredState.asReadonly();
  readonly authenticated = computed(() => {
    const session = this.session();
    return session !== null && session.expiresAt > Date.now();
  });

  constructor() {
    this.restore();
  }

  startSession(response: TokenResponse): void {
    if (typeof response.access_token !== 'string' || !response.access_token.trim()
        || typeof response.token_type !== 'string'
        || response.token_type.toLowerCase() !== 'bearer'
        || !Number.isSafeInteger(response.expires_in)
        || response.expires_in <= 0 || response.expires_in * 1000 > MAX_TIMER_MS) {
      throw new Error('Invalid local login response');
    }
    this.logout();
    const session: Session = {
      token: response.access_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      permissions: typeof response.scope === 'string' ? response.scope.split(/\s+/).filter(Boolean) : []
    };
    this.activate(session);
    try {
      this.storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 1, ...session }));
    } catch {
      // No storage access is needed to use the current in-memory session.
      this.storage = null;
    }
  }

  // These permissions control presentation only, never backend authorization.
  hasScope(permission: string): boolean {
    return this.authenticated() && this.session()?.permissions.includes(permission) === true;
  }

  accessToken(): string | null {
    const session = this.session();
    if (session === null) return null;
    if (session.expiresAt <= Date.now()) {
      this.expire();
      return null;
    }
    return session.token;
  }

  expire(token?: string): void {
    // A late 401 from an earlier request must not clear a newer login.
    if (token !== undefined && this.session()?.token !== token) return;
    this.clear();
    this.expiredState.set(true);
  }

  logout(): void {
    this.clear();
    this.expiredState.set(false);
  }

  ngOnDestroy(): void {
    // Reloading destroys memory, not the tab's stored absolute expiry.
    this.stopTimer();
  }

  private activate(session: Session): void {
    this.stopTimer();
    this.session.set(session);
    this.expiryTimer = setTimeout(() => this.expire(session.token), session.expiresAt - Date.now());
  }

  private restore(): void {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(SESSION_STORAGE_KEY) ?? null;
    } catch {
      this.storage = null;
      return;
    }
    if (raw === null) return;
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      this.removeStored();
      return;
    }
    if (!this.isStoredSession(stored)) {
      this.removeStored();
      return;
    }
    const remaining = stored.expiresAt - Date.now();
    if (remaining <= 0) {
      this.removeStored();
      this.expiredState.set(true);
      return;
    }
    if (remaining > MAX_TIMER_MS) {
      this.removeStored();
      return;
    }
    this.activate({
      token: stored.token,
      expiresAt: stored.expiresAt,
      permissions: stored.permissions
    });
  }

  private isStoredSession(value: unknown): value is Session & { version: 1 } {
    if (!value || typeof value !== 'object'
        || Object.keys(value).sort().join(',') !== 'expiresAt,permissions,token,version') return false;
    if (!('version' in value) || value.version !== 1
        || !('token' in value) || typeof value.token !== 'string' || !value.token.trim()
        || !('expiresAt' in value) || typeof value.expiresAt !== 'number'
        || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0
        || !('permissions' in value) || !Array.isArray(value.permissions)) return false;
    return value.permissions.every((permission: unknown) => typeof permission === 'string');
  }

  private stopTimer(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  private removeStored(): void {
    try {
      this.storage?.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Some storage shims deny removal while still allowing an overwrite.
      try { this.storage?.setItem(SESSION_STORAGE_KEY, ''); } catch { /* Remain memory-only. */ }
      this.storage = null;
    }
  }

  private clear(): void {
    this.stopTimer();
    this.session.set(null);
    this.removeStored();
  }
}
