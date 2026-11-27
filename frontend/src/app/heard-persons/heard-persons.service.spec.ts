import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HeardPerson, HeardPersonInput, HeardPersonsService } from './heard-persons.service';

const path = '/api/heard-persons';
const row: HeardPerson = { id: 'fictitious-id', reference: 'FICTITIOUS-REF', minorityStatus: 'UNKNOWN', version: 2 };
describe('Minimal heard-person HTTP contract', () => {
  let http: HttpTestingController;
  let api: HeardPersonsService;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(HeardPersonsService);
  });
  afterEach(() => http.verify());

  it('lists and reads representations by an encoded technical identifier', () => {
    api.list().subscribe(rows => expect(rows).toEqual([row]));
    http.expectOne(path).flush([row]);
    api.get('fictitious/id').subscribe(person => expect(person).toEqual(row));
    http.expectOne(path + '/fictitious%2Fid').flush(row);
  });

  it('creates only the trimmed reference and explicit status, without arbitrary fields', () => {
    api.create({ reference: '  FICTITIOUS-REF  ', minorityStatus: 'UNKNOWN', version: 99,
      dateOfBirth: 'must-not-be-sent' } as HeardPersonInput).subscribe();
    const request = http.expectOne(path);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reference: row.reference, minorityStatus: 'UNKNOWN' });
    request.flush(row);
  });

  it('updates only allowed values using the version captured by the editor', () => {
    api.update(row.id, { ...row, reference: ' EDITED-REF ', minorityStatus: 'MINOR', version: 99 } as HeardPerson, 2).subscribe();
    const request = http.expectOne(path + '/' + row.id);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ reference: 'EDITED-REF', minorityStatus: 'MINOR', version: 2 });
    request.flush({ ...row, reference: 'EDITED-REF', minorityStatus: 'MINOR', version: 3 });
  });
});
