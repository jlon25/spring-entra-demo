import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface HearingTypeInput {
  label: string;
  durationMinutes: number;
  pauseMinutes: number;
  defenderRequired: boolean;
}

export interface HearingType extends HearingTypeInput {
  id: string;
  version: number;
}

@Injectable({ providedIn: 'root' })
export class HearingTypesService {
  private readonly http = inject(HttpClient);
  private readonly path = '/api/hearing-types';

  list(): Observable<HearingType[]> {
    return this.http.get<HearingType[]>(this.path);
  }

  get(id: string): Observable<HearingType> {
    return this.http.get<HearingType>(this.path + '/' + encodeURIComponent(id));
  }

  create(input: HearingTypeInput): Observable<HearingType> {
    return this.http.post<HearingType>(this.path, this.payload(input));
  }

  update(id: string, input: HearingTypeInput, version: number): Observable<HearingType> {
    return this.http.put<HearingType>(this.path + '/' + encodeURIComponent(id),
      { ...this.payload(input), version });
  }

  remove(id: string, version: number): Observable<void> {
    return this.http.delete<void>(this.path + '/' + encodeURIComponent(id),
      { params: { version } });
  }

  private payload(input: HearingTypeInput): HearingTypeInput {
    return {
      label: input.label.trim(),
      durationMinutes: input.durationMinutes,
      pauseMinutes: input.pauseMinutes,
      defenderRequired: input.defenderRequired
    };
  }
}
