import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HearingType, HearingTypeInput, HearingTypesService } from './hearing-types.service';

const input: HearingTypeInput = {
  label: '  Type fictif  ', durationMinutes: 60, pauseMinutes: 0, defenderRequired: true
};
const row: HearingType = { ...input, label: 'Type fictif', id: 'fictitious-id', version: 2 };

describe('Hearing types HTTP contract', () => {
  let api: HearingTypesService;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(HearingTypesService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('lists and reads the API representations', () => {
    let rows: HearingType[] = [];
    api.list().subscribe(value => rows = value);
    http.expectOne('/api/hearing-types').flush([row]);
    expect(rows).toEqual([row]);
    api.get(row.id).subscribe(value => expect(value).toEqual(row));
    http.expectOne('/api/hearing-types/' + row.id).flush(row);
  });

  it('creates only editable fields, trimming the label and preserving zero pause', () => {
    api.create({ ...input, id: 'unwanted', version: 99 } as HearingType).subscribe();
    const request = http.expectOne('/api/hearing-types');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      label: 'Type fictif', durationMinutes: 60, pauseMinutes: 0, defenderRequired: true
    });
    request.flush(row);
  });

  it('updates with the version read by the editor, not a version supplied in the input', () => {
    api.update(row.id, { ...input, version: 99 } as HearingType, row.version).subscribe();
    const request = http.expectOne('/api/hearing-types/' + row.id);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      label: 'Type fictif', durationMinutes: 60, pauseMinutes: 0, defenderRequired: true, version: 2
    });
    request.flush({ ...row, version: 3 });
  });
});
