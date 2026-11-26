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
    // jsdom does not implement native modal focus trapping/top-layer behavior.
    // These stand-ins cover component state only; Playwright covers browser semantics.
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = true; })
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = false; })
    });
    permissions.hasScope.mockReset().mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [HearingTypesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: permissions }]
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

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


  it('keeps explicit names on icon actions and decorates their SVGs without changing the actions', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    for (const action of ['Modifier', 'Supprimer']) {
      const button = fixture.nativeElement.querySelector('[aria-label="' + action + ' Type fictif"]') as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.type).toBe('button');
      expect(button.title).toBe(action + ' Type fictif');
      expect(button.querySelector('.action-label')?.textContent).toBe(action);
      const icon = button.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.getAttribute('focusable')).toBe('false');
    }
    // CSS visibility and mobile dimensions are verified by real browser tests.
    const edit = fixture.nativeElement.querySelector('[aria-label="Modifier Type fictif"]') as HTMLButtonElement;
    edit.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.form.controls.durationMinutes.value).toBe(60);
    expect(fixture.componentInstance.form.controls.pauseMinutes.value).toBe(15);
    expect(fixture.componentInstance.form.controls.defenderRequired.value).toBe(true);
    http.expectNone(request => request.method === 'PUT' || request.method === 'DELETE');
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

  it('requires confirmation and cancels deletion without any HTTP request', () => {
    const page = component();
    page.requestDeletion(row);
    expect(page.deletion()?.id).toBe(row.id);
    http.expectNone(request => request.method === 'DELETE');
    page.cancelDeletion();
    expect(page.deletion()).toBeNull();
    http.expectNone(request => request.method === 'DELETE');
  });

  it('deletes the captured version once and closes an editor for that type', () => {
    const page = component();
    page.edit(row);
    page.requestDeletion(row);
    page.confirmDeletion();
    page.confirmDeletion();
    const request = http.expectOne(path + '/' + row.id + '?version=2');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(page.deletion()).toBeNull();
    expect(page.editor()).toBeNull();
    expect(page.status()).toContain('supprimé');
    http.expectOne(path).flush([]);
  });

  it('does not offer deletion in read-only mode', async () => {
    permissions.hasScope.mockReturnValue(false);
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-label="Supprimer Type fictif"]')).toBeNull();
    fixture.componentInstance.requestDeletion(row);
    fixture.componentInstance.confirmDeletion();
    expect(fixture.componentInstance.deletion()).toBeNull();
    http.expectNone(request => request.method === 'DELETE');
  });

  it('blocks stale or missing deletions until list reload and fresh confirmation', () => {
    const page = component();
    for (const status of [409, 404]) {
      page.requestDeletion(row);
      page.confirmDeletion();
      http.expectOne(path + '/' + row.id + '?version=2')
        .flush({}, { status, statusText: 'Conflict or missing' });
      expect(page.deleteBlocked()).toBe(true);
      expect(page.deletion()?.version).toBe(2);
      page.confirmDeletion();
      http.expectNone(request => request.method === 'DELETE');
      page.reloadForDeletion();
      http.expectOne(path).flush([{ ...row, version: 3 }]);
      expect(page.deletion()).toBeNull();
    }
    page.requestDeletion({ ...row, version: 3 });
    page.confirmDeletion();
    http.expectOne(path + '/' + row.id + '?version=3')
      .flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(path).flush([]);
  });

  it('preserves another type draft and explains a forbidden deletion', () => {
    const page = component();
    page.edit({ ...row, id: 'other-type' });
    page.form.controls.label.setValue('Brouillon conservé');
    page.requestDeletion(row);
    page.confirmDeletion();
    http.expectOne(path + '/' + row.id + '?version=2')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.deleteError()).toContain('Vos droits');
    expect(page.form.controls.label.value).toBe('Brouillon conservé');
    page.cancelDeletion();
    expect(page.editor()?.id).toBe('other-type');
    expect(page.form.controls.label.value).toBe('Brouillon conservé');
  });

  it('cancels an edit without sending a request', () => {
    const page = component(); page.edit(row); page.cancel();
    expect(page.editor()).toBeNull();
    http.expectNone(path + '/' + row.id);
  });
  it('opens an accessible editor dialog and cancels it without a write', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('[aria-label="Modifier Type fictif"]') as HTMLButtonElement;
    trigger.click();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe('editor-title');
    expect(dialog.textContent).not.toContain('Version lue');
    expect(document.activeElement).toBe(dialog.querySelector('#type-label'));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    http.expectNone(request => request.method === 'PUT' || request.method === 'DELETE');
  });

  it('keeps the editor open on Escape while a write is pending', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([]);
    fixture.componentInstance.create();
    await fixture.whenStable();
    valid(fixture.componentInstance);
    fixture.componentInstance.save();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.editor()).not.toBeNull();
    expect(dialog.open).toBe(true);
    http.expectOne(path).flush({ ...row, version: 0 });
    http.expectOne(path).flush([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
  });

  it('focuses the safe deletion action and refuses Escape during deletion', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([row]);
    await fixture.whenStable();
    const trigger = fixture.nativeElement.querySelector('[aria-label="Supprimer Type fictif"]') as HTMLButtonElement;
    trigger.click();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Annuler la suppression');
    fixture.componentInstance.confirmDeletion();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(fixture.componentInstance.deletion()?.id).toBe(row.id);
    http.expectOne(path + '/' + row.id + '?version=2')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cycles Tab boundaries, excludes disabled controls and handles summary focus', async () => {
    const fixture = TestBed.createComponent(HearingTypesComponent);
    fixture.detectChanges();
    http.expectOne(path).flush([]);
    fixture.componentInstance.create();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    const first = dialog.querySelector('#type-label') as HTMLInputElement;
    const last = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Annuler')!;
    first.focus();
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    first.dispatchEvent(backwards);
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    const forwards = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(forwards);
    expect(forwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    // Invalid input moves focus to a summary outside the sequential tab order.
    fixture.componentInstance.save();
    await fixture.whenStable();
    const summary = dialog.querySelector('[role="alert"]') as HTMLElement;
    expect(document.activeElement).toBe(summary);
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);

    // All inputs/buttons inherit disabled from the fieldset during a write.
    valid(fixture.componentInstance);
    fixture.componentInstance.save();
    await fixture.whenStable();
    dialog.focus();
    const busyTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(busyTab);
    expect(busyTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
    http.expectOne(path).flush({ ...row, version: 0 });
    http.expectOne(path).flush([]);
  });

});
