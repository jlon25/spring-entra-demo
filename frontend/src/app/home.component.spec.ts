import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HomeComponent } from './home.component';
import { I18nService, LANGUAGE_STORAGE } from './i18n/i18n.service';

describe('Protected API feedback', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: LANGUAGE_STORAGE, useValue: null }]
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('displays successful API access without showing a token', async () => {
    const fixture = TestBed.createComponent(HomeComponent);
    await fixture.whenStable();
    fixture.componentInstance.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message').flush({ message: 'authenticated' });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent)
      .toContain('Accès à l’API confirmé : authenticated');
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('explains insufficient permissions distinctly from a network error', () => {
    const component = TestBed.createComponent(HomeComponent).componentInstance;
    component.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(component.error()).toBe('Votre session est valide, mais les droits sont insuffisants.');
    expect(component.message()).toBe('');
    component.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message').error(new ProgressEvent('error'));
    expect(component.error()).toContain('L’API est inaccessible');
  });
  it('translates an existing API error without making a new request', () => {
    const component = TestBed.createComponent(HomeComponent).componentInstance;
    component.checkApi();
    TestBed.inject(HttpTestingController).expectOne('/api/message')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    TestBed.inject(I18nService).setLanguage('de');
    expect(component.error()).toBe('Ihre Sitzung ist gültig, aber Ihre Berechtigungen reichen nicht aus.');
    TestBed.inject(I18nService).setLanguage('it');
    expect(component.error()).toBe('La sessione è valida, ma le autorizzazioni non sono sufficienti.');
    TestBed.inject(HttpTestingController).expectNone('/api/message');
  });
});
