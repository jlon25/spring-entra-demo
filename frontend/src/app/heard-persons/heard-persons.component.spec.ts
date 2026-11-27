import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth.service';
import { I18nService, LANGUAGE_STORAGE } from '../i18n/i18n.service';
import { HeardPersonsComponent } from './heard-persons.component';
import { HeardPerson, MinorityStatus } from './heard-persons.service';

const path = '/api/heard-persons';
const row: HeardPerson = { id: 'fictitious-id', reference: 'FICTITIOUS-REF', minorityStatus: 'UNKNOWN', version: 2 };

describe('Minimal persons page with simulated HTTP responses', () => {
  let http: HttpTestingController;
  const permissions = { hasScope: vi.fn(() => true) };
  beforeEach(() => {
    // jsdom stand-ins cover component state; Chromium verifies real modal behavior.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = true; })
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = false; })
    });
    permissions.hasScope.mockReset().mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [HeardPersonsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: permissions }, { provide: LANGUAGE_STORAGE, useValue: null }]
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  function component(): HeardPersonsComponent {
    const fixture = TestBed.createComponent(HeardPersonsComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([]);
    return fixture.componentInstance;
  }
  function valid(page: HeardPersonsComponent): void {
    page.form.setValue({ reference: ' FICTITIOUS-NEW ', minorityStatus: 'UNKNOWN' });
  }

  it('shows the empty state and a loaded reference without asking for identity data', async () => {
    const fixture = TestBed.createComponent(HeardPersonsComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Aucune personne');
    fixture.componentInstance.load();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain(row.reference);
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Non renseigné');
    fixture.componentInstance.create();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('input').length).toBe(1);
    expect(fixture.nativeElement.querySelector('input').id).toBe('person-reference');
    expect(fixture.componentInstance.form.controls.minorityStatus.value).toBe('UNKNOWN');
  });

  it('hides mutations and refuses programmatic editing without write permission', async () => {
    permissions.hasScope.mockReturnValue(false);
    const fixture = TestBed.createComponent(HeardPersonsComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Consultation uniquement');
    expect(fixture.nativeElement.querySelector('tbody button')).toBeNull();
    fixture.componentInstance.create();
    fixture.componentInstance.edit(row);
    expect(fixture.componentInstance.editor()).toBeNull();
    http.expectNone(request => ['POST', 'PUT'].includes(request.method));
  });

  it('rejects empty or oversized references and unknown status before any write', () => {
    const page = component();
    page.create();
    for (const reference of ['', '   ', 'x'.repeat(121)]) {
      page.form.setValue({ reference, minorityStatus: 'UNKNOWN' });
      page.save();
      expect(page.fieldError('reference')).not.toBe('');
    }
    page.form.setValue({ reference: row.reference, minorityStatus: 'unexpected' as MinorityStatus });
    page.save();
    expect(page.fieldError('minorityStatus')).not.toBe('');
    http.expectNone(request => request.method === 'POST');
  });

  it('creates with UNKNOWN explicitly, prevents duplicate submission and reloads the list', () => {
    const page = component();
    page.create(); valid(page); page.save(); page.save();
    const request = http.expectOne(path);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ reference: 'FICTITIOUS-NEW', minorityStatus: 'UNKNOWN' });
    request.flush({ ...row, reference: 'FICTITIOUS-NEW', version: 0 });
    http.expectOne(path).flush([row]);
    expect(page.editor()).toBeNull();
    expect(page.status()).toBe('Personne enregistrée.');
  });

  it('uses the read version and preserves MINOR as a distinct status', () => {
    const page = component();
    page.edit({ ...row, minorityStatus: 'MINOR' });
    page.form.controls.reference.setValue('FICTITIOUS-UPDATED');
    page.save();
    const request = http.expectOne(path + '/' + row.id);
    expect(request.request.body).toEqual({ reference: 'FICTITIOUS-UPDATED', minorityStatus: 'MINOR', version: 2 });
    request.flush({ ...row, reference: 'FICTITIOUS-UPDATED', minorityStatus: 'MINOR', version: 3 });
    http.expectOne(path).flush([]);
    expect(page.editor()).toBeNull();
  });

  it('keeps a duplicate-reference draft editable instead of treating it as a stale version', () => {
    const page = component();
    page.create(); valid(page); page.form.controls.minorityStatus.setValue('ADULT'); page.save();
    http.expectOne(path).flush({ code: 'reference_conflict' }, { status: 409, statusText: 'Conflict' });
    expect(page.conflict()).toBe(false);
    expect(page.fieldError('reference')).toContain('déjà utilisée');
    expect(page.form.getRawValue()).toEqual({ reference: ' FICTITIOUS-NEW ', minorityStatus: 'ADULT' });
    page.form.controls.reference.setValue('FICTITIOUS-OTHER');
    page.save();
    http.expectOne(path).flush({ ...row, reference: 'FICTITIOUS-OTHER', minorityStatus: 'ADULT', version: 0 });
    http.expectOne(path).flush([]);
  });

  it('preserves a stale draft, blocks retries and explicitly reloads before a new save', () => {
    const page = component();
    page.edit(row); page.form.controls.minorityStatus.setValue('MINOR'); page.save();
    http.expectOne(path + '/' + row.id).flush({ code: 'concurrent_modification' }, { status: 409, statusText: 'Conflict' });
    expect(page.conflict()).toBe(true);
    expect(page.form.controls.minorityStatus.value).toBe('MINOR');
    page.save();
    http.expectNone(request => request.method === 'PUT');
    TestBed.inject(I18nService).setLanguage('de');
    expect(page.error()).toContain('anderweitig');
    expect(page.form.controls.reference.value).toBe(row.reference);
    page.reloadVersion();
    http.expectOne(path + '/' + row.id).flush({ ...row, minorityStatus: 'ADULT', version: 3 });
    expect(page.form.controls.minorityStatus.value).toBe('ADULT');
    expect(page.conflict()).toBe(false);
    page.save();
    const request = http.expectOne(path + '/' + row.id);
    expect(request.request.body.version).toBe(3);
    request.flush({ ...row, minorityStatus: 'ADULT', version: 4 });
    http.expectOne(path).flush([]);
  });

  it('maps server field errors without displaying server values and retains the draft', () => {
    const page = component();
    page.create(); valid(page); page.save();
    http.expectOne(path).flush({ errors: [{ field: 'reference', message: 'RAW-SERVER-MESSAGE' }] },
      { status: 400, statusText: 'Bad Request' });
    expect(page.fieldError('reference')).toContain('120');
    expect(page.fieldError('reference')).not.toContain('RAW-SERVER');
    expect(page.form.controls.reference.value).toBe(' FICTITIOUS-NEW ');
  });

  it('distinguishes read refusals and network errors and permits retry', () => {
    const page = component();
    page.load(); http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.loadError()).toContain('Vos droits');
    page.load(); http.expectOne(path).error(new ProgressEvent('error'));
    expect(page.loadError()).toContain('Service inaccessible');
    page.load(); http.expectOne(path).flush([row]);
    expect(page.loadError()).toBe('');
  });

  it('opens the named modal and refuses Escape while a request is pending', async () => {
    const fixture = TestBed.createComponent(HeardPersonsComponent);
    fixture.detectChanges(); http.expectOne(path).flush([]);
    fixture.componentInstance.create();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('person-editor-title');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#person-reference'));
    valid(fixture.componentInstance);
    fixture.componentInstance.save();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.editor()).not.toBeNull();
    http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.editor()).toBeNull();
  });

  it('cancels without an HTTP write and keeps UNKNOWN separate from ADULT', () => {
    const page = component();
    page.create(); page.cancel();
    expect(page.editor()).toBeNull();
    expect(page.minorityLabel('UNKNOWN')).toBe('Non renseigné');
    expect(page.minorityLabel('ADULT')).toBe('Majeur');
    http.expectNone(request => request.method === 'POST' || request.method === 'PUT');
  });
});
