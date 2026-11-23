import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export function isApiUrl(rawUrl: string, origin: string): boolean {
  const address = rawUrl.split(/[?#]/, 1)[0];
  if (address.includes('%') || address.includes('\\') || /\/\.{1,2}(?:\/|$)/.test(address)) {
    return false;
  }
  try {
    const url = new URL(rawUrl, origin + '/');
    return url.origin === origin && !url.username && !url.password
      && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiUrl(request.url, window.location.origin)) return next(request);
  const auth = inject(AuthService);
  const token = auth.accessToken();
  const outgoing = token
    ? request.clone({ setHeaders: { Authorization: 'Bearer ' + token } })
    : request;
  return next(outgoing).pipe(catchError((error: unknown) => {
    if (token && error instanceof HttpErrorResponse && error.status === 401) {
      auth.expire(token);
    }
    return throwError(() => error);
  }));
};
