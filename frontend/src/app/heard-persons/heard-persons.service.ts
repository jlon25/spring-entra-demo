import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type MinorityStatus = 'MINOR' | 'ADULT' | 'UNKNOWN';
export interface HeardPersonInput {
  reference: string;
  minorityStatus: MinorityStatus;
}
export interface HeardPerson extends HeardPersonInput {
  id: string;
  version: number;
}

@Injectable({ providedIn: 'root' })
export class HeardPersonsService {
  private readonly http = inject(HttpClient);
  private readonly path = '/api/heard-persons';

  list(): Observable<HeardPerson[]> { return this.http.get<HeardPerson[]>(this.path); }
  get(id: string): Observable<HeardPerson> {
    return this.http.get<HeardPerson>(this.path + '/' + encodeURIComponent(id));
  }
  create(input: HeardPersonInput): Observable<HeardPerson> {
    return this.http.post<HeardPerson>(this.path, this.payload(input));
  }
  update(id: string, input: HeardPersonInput, version: number): Observable<HeardPerson> {
    return this.http.put<HeardPerson>(this.path + '/' + encodeURIComponent(id),
      { ...this.payload(input), version });
  }
  private payload(input: HeardPersonInput): HeardPersonInput {
    // Explicit allowlist: identity data and arbitrary fields cannot leak from a form.
    return { reference: input.reference.trim(), minorityStatus: input.minorityStatus };
  }
}
