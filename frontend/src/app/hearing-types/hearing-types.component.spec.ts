import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth.service';
import { HearingTypesComponent } from './hearing-types.component';
import { HearingType } from './hearing-types.service';

const path = '/api/hearing-types';
const row: HearingType = {
  id: 'fictitious-type', label: 'Type fictif', durationMinutes: 60,
  pauseMinutes: 15, defenderRequired: true, version: 2
};

describe('Hearing types page with simulated HTTP responses', () => {
  let http: HttpTestingController;
  const permissions = { hasScope: vi.fn(() => true) };
  beforeEach(() => {
    permissions.hasScope.mockReset().mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [HearingTypesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: permissions }]
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function component(): HearingTypesComponent {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([]);
    return fixture.componentInstance;
  }

  function valid(page: HearingTypesComponent): void {
    page.form.setValue({ label: '  Nouveau fictif  ', durationMinutes: 60, pauseMinutes: 0, defenderRequired: false });
  }

  it('displays the initial empty state and then a loaded row', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.loading()).toBe(true);
    http.expectOne(path).flush([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Aucun type d’audition');
    fixture.componentInstance.load();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Type fictif');
    expect(fixture.nativeElement.querySelector('caption').textContent).toContain('Référentiel');
  });

  it('distinguishes a read refusal from network unavailability and permits retry', () => {
    const page = component();
    page.load();
    http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.loadError()).toContain('Vos droits');
    page.load();
    http.expectOne(path).error(new ProgressEvent('error'));
    expect(page.loadError()).toContain('Service inaccessible');
    page.load();
    http.expectOne(path).flush([row]);
    expect(page.loadError()).toBe('');
    expect(page.types()).toEqual([row]);
  });

  it('does not offer write controls or create a form without write permission', async () => {
    permissions.hasScope.mockReturnValue(false);
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Consultation uniquement');
    expect(fixture.nativeElement.querySelector('tbody button')).toBeNull();
    fixture.componentInstance.create();
    fixture.componentInstance.edit(row);
    expect(fixture.componentInstance.editor()).toBeNull();
  });

  it('refuses empty labels, invalid integers, nonpositive duration and negative pause before HTTP', () => {
    const page = component();
    page.create();
    expect(page.form.controls.durationMinutes.value).toBeNull();
    expect(page.form.controls.pauseMinutes.value).toBeNull();
    for (const label of [' ', 'x'.repeat(121)]) {
      valid(page); page.form.controls.label.setValue(label); page.save();
      expect(page.form.invalid).toBe(true);
    }
    for (const duration of [null, 0, -1, 1.5, 2_147_483_648]) {
      valid(page); page.form.controls.durationMinutes.setValue(duration); page.save();
      expect(page.form.invalid).toBe(true);
    }
    for (const pause of [null, -1, 0.5, 2_147_483_648]) {
      valid(page); page.form.controls.pauseMinutes.setValue(pause); page.save();
      expect(page.form.invalid).toBe(true);
    }
    http.expectNone(path);
  });

  it('creates a zero-pause type, prevents double submission and refreshes the list', () => {
    const page = component();
    page.create(); valid(page); page.save(); page.save();
    const request = http.expectOne(path);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.pauseMinutes).toBe(0);
    expect(request.request.body.label).toBe('Nouveau fictif');
    expect(request.request.body.version).toBeUndefined();
    request.flush({ ...row, label: 'Nouveau fictif', pauseMinutes: 0, version: 0 });
    expect(page.editor()).toBeNull();
    expect(page.saving()).toBe(false);
    expect(page.status()).toContain('enregistré');
    http.expectOne(path).flush([{ ...row, pauseMinutes: 0 }]);
    expect(page.types()[0].pauseMinutes).toBe(0);
  });

  it('uses the version read for editing and preserves drafts during list refresh', () => {
    const page = component();
    page.edit(row);
    page.form.controls.label.setValue('Brouillon');
    page.load();
    http.expectOne(path).flush([{ ...row, version: 3 }]);
    expect(page.form.controls.label.value).toBe('Brouillon');
    page.save();
    const request = http.expectOne(path + '/' + row.id);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body.version).toBe(2);
    request.flush({ ...row, version: 3 });
    http.expectOne(path).flush([]);
  });

  it('maps server field validation errors and keeps the draft', () => {
    const page = component();
    page.create(); valid(page); page.save();
    http.expectOne(path).flush({
      errors: [{ field: 'label', message: 'Libellé refusé.' }, { field: 'ignored', message: 'Ignored' }]
    }, { status: 400, statusText: 'Bad Request' });
    expect(page.fieldError('label')).toBe('Libellé refusé.');
    expect(page.form.controls.label.value).toBe('  Nouveau fictif  ');
    expect(page.error()).toContain('serveur');
  });

  it('keeps the form on a write refusal or missing resource', () => {
    const page = component();
    page.edit(row);
    page.form.controls.label.setValue('Saisie conservée');
    for (const status of [403, 404]) {
      page.save();
      http.expectOne(path + '/' + row.id).flush({}, { status, statusText: 'Rejected' });
      expect(page.editor()?.version).toBe(2);
      expect(page.form.controls.label.value).toBe('Saisie conservée');
      expect(page.error()).toContain(status === 403 ? 'Vos droits' : 'introuvable');
    }
  });

  it('preserves a conflicted draft and reloads server data only after an explicit action', () => {
    const page = component();
    page.edit(row);
    page.form.controls.label.setValue('Brouillon concurrent');
    page.save();
    http.expectOne(path + '/' + row.id).flush({}, { status: 409, statusText: 'Conflict' });
    expect(page.conflict()).toBe(true);
    expect(page.editor()?.version).toBe(2);
    expect(page.form.controls.label.value).toBe('Brouillon concurrent');
    http.expectNone(path + '/' + row.id);
    page.save();
    http.expectNone(path + '/' + row.id);
    page.reloadVersion();
    const reload = http.expectOne(path + '/' + row.id);
    expect(reload.request.method).toBe('GET');
    reload.flush({ ...row, label: 'Version serveur', version: 3, pauseMinutes: 0 });
    expect(page.conflict()).toBe(false);
    expect(page.form.controls.label.value).toBe('Version serveur');
    expect(page.editor()?.version).toBe(3);
    page.form.controls.durationMinutes.setValue(75);
    page.save();
    const update = http.expectOne(path + '/' + row.id);
    expect(update.request.body.version).toBe(3);
    expect(update.request.body.pauseMinutes).toBe(0);
    update.flush({ ...row, durationMinutes: 75, version: 4, pauseMinutes: 0 });
    http.expectOne(path).flush([]);
  });

  it('cancels an edit without sending a request', () => {
    const page = component(); page.edit(row); page.cancel();
    expect(page.editor()).toBeNull();
    http.expectNone(path + '/' + row.id);
  });
});
