import { Injectable, computed, signal } from '@angular/core';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface Session {
  token: string;
  expiresAt: number;
}

/** Browser memory only. Server JWT validation remains authoritative. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<Session | null>(null);
  private readonly expiredState = signal(false);
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly expired = this.expiredState.asReadonly();
  readonly authenticated = computed(() => {
    const session = this.session();
    return session !== null && session.expiresAt > Date.now();
  });

  startSession(response: TokenResponse): void {
    if (typeof response.access_token !== 'string' || !response.access_token.trim()
        || typeof response.token_type !== 'string'
        || response.token_type.toLowerCase() !== 'bearer'
        || !Number.isFinite(response.expires_in)
        || response.expires_in <= 0 || response.expires_in > 300) {
      throw new Error('Invalid local login response');
    }
    this.logout();
    const duration = response.expires_in * 1000;
    this.session.set({ token: response.access_token, expiresAt: Date.now() + duration });
    this.expiryTimer = setTimeout(() => this.expire(), duration);
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

  private clear(): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.session.set(null);
  }
}
